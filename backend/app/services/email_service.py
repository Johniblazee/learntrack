"""Email service using Plunk for sending transactional emails."""

from dataclasses import dataclass
from datetime import datetime
import importlib
import os
from typing import Optional

import structlog

logger = structlog.get_logger()

PLUNK_API_KEY = os.getenv("PLUNK_API_KEY", "").strip()

try:
    plunk = importlib.import_module("plunk")
except (ImportError, AttributeError):
    plunk = None


@dataclass
class EmailDeliveryResult:
    """Normalized provider response for delivery attempts."""

    delivered: bool
    provider: str
    provider_message_id: Optional[str] = None
    error: Optional[str] = None


def _extract_provider_message_id(response: object) -> Optional[str]:
    """Best-effort extraction of provider message id from unknown response shapes."""
    if response is None:
        return None

    if isinstance(response, dict):
        candidate = (
            response.get("id")
            or response.get("message_id")
            or response.get("messageId")
            or response.get("request_id")
        )
        return str(candidate) if candidate else None

    for attr in ("id", "message_id", "messageId", "request_id"):
        candidate = getattr(response, attr, None)
        if candidate:
            return str(candidate)

    return None


plunk_client = plunk.Plunk(PLUNK_API_KEY) if (plunk and PLUNK_API_KEY) else None


class EmailService:
    """Service for sending emails via Plunk"""

    @staticmethod
    def _send_with_plunk(
        to_email: str,
        subject: str,
        html_body: str,
        *,
        category: str,
    ) -> EmailDeliveryResult:
        """Send an email through Plunk and normalize result semantics."""
        if not to_email:
            return EmailDeliveryResult(
                delivered=False,
                provider="plunk",
                error="Recipient email is required",
            )

        if not plunk_client:
            logger.error(
                "Email provider unavailable",
                provider="plunk",
                category=category,
                recipient=to_email,
                plunk_configured=bool(PLUNK_API_KEY),
            )
            return EmailDeliveryResult(
                delivered=False,
                provider="plunk",
                error="Plunk is not configured",
            )

        try:
            response = plunk_client.emails.send(
                to=to_email,
                subject=subject,
                body=html_body,
            )
            provider_message_id = _extract_provider_message_id(response)
            logger.info(
                "Email sent",
                provider="plunk",
                category=category,
                recipient=to_email,
                provider_message_id=provider_message_id,
            )
            return EmailDeliveryResult(
                delivered=True,
                provider="plunk",
                provider_message_id=provider_message_id,
            )
        except Exception as exc:
            error_message = str(exc)
            logger.error(
                "Email send failed",
                provider="plunk",
                category=category,
                recipient=to_email,
                error=error_message,
            )
            return EmailDeliveryResult(
                delivered=False,
                provider="plunk",
                error=error_message,
            )

    @staticmethod
    def send_invitation_email(
        to_email: str, to_name: str, from_name: str, role: str, invitation_link: str
    ) -> bool:
        """
        Send invitation email to new user

        Args:
            to_email: Recipient email address
            to_name: Recipient name
            from_name: Teacher/inviter name
            role: User role (student/parent)
            invitation_link: Full invitation URL

        Returns:
            bool: True if email sent successfully
        """
        try:
            subject = f"You're invited to join LearnTrack by {from_name}"

            html_body = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: linear-gradient(135deg, #9333ea 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }}
                    .button {{ display: inline-block; background: #9333ea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
                    .footer {{ text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎓 Welcome to LearnTrack!</h1>
                    </div>
                    <div class="content">
                        <p>Hi {to_name},</p>
                        <p><strong>{from_name}</strong> has invited you to join LearnTrack as a <strong>{role}</strong>.</p>
                        <p>LearnTrack is an educational platform that helps teachers, students, and parents collaborate on learning.</p>
                        <p style="text-align: center;">
                            <a href="{invitation_link}" class="button">Accept Invitation</a>
                        </p>
                        <p style="font-size: 14px; color: #6b7280;">
                            Or copy and paste this link into your browser:<br>
                            <a href="{invitation_link}">{invitation_link}</a>
                        </p>
                        <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                            This invitation will expire in 2 weeks (14 days).
                        </p>
                    </div>
                    <div class="footer">
                        <p>© 2025 LearnTrack. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
            """

            result = EmailService._send_with_plunk(
                to_email=to_email,
                subject=subject,
                html_body=html_body,
                category="invitation",
            )
            return result.delivered

        except Exception as e:
            logger.error(
                "Failed to build invitation email", recipient=to_email, error=str(e)
            )
            return False

    @staticmethod
    def send_welcome_email(
        to_email: str, to_name: str, role: str, dashboard_link: str
    ) -> bool:
        """
        Send welcome email after user completes onboarding

        Args:
            to_email: User email address
            to_name: User name
            role: User role (tutor/student/parent)
            dashboard_link: Link to user's dashboard

        Returns:
            bool: True if email sent successfully
        """
        try:
            subject = "Welcome to LearnTrack! 🎉"

            role_specific_content = {
                "tutor": {
                    "emoji": "👨‍🏫",
                    "title": "Start Teaching with LearnTrack",
                    "features": [
                        "Invite students and parents",
                        "Create assignments and questions",
                        "Chat with students and parents",
                        "Upload reference materials",
                        "Track student progress",
                    ],
                },
                "student": {
                    "emoji": "📚",
                    "title": "Start Learning with LearnTrack",
                    "features": [
                        "View and complete assignments",
                        "Chat with your teacher and parents",
                        "Access learning materials",
                        "Track your progress",
                        "Get instant feedback",
                    ],
                },
                "parent": {
                    "emoji": "👨‍👩‍👧",
                    "title": "Support Your Child's Learning",
                    "features": [
                        "View your child's assignments",
                        "Chat with the teacher",
                        "Monitor progress and grades",
                        "Receive deadline notifications",
                        "Stay involved in learning",
                    ],
                },
            }

            content = role_specific_content.get(
                role.lower(), role_specific_content["student"]
            )
            features_html = "".join(
                [f"<li>{feature}</li>" for feature in content["features"]]
            )

            html_body = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: linear-gradient(135deg, #9333ea 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }}
                    .button {{ display: inline-block; background: #9333ea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
                    .features {{ background: white; padding: 20px; border-radius: 6px; margin: 20px 0; }}
                    .features ul {{ margin: 10px 0; padding-left: 20px; }}
                    .footer {{ text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>{content["emoji"]} {content["title"]}</h1>
                    </div>
                    <div class="content">
                        <p>Hi {to_name},</p>
                        <p>Welcome to LearnTrack! We're excited to have you on board. 🎉</p>
                        <div class="features">
                            <h3>What you can do:</h3>
                            <ul>
                                {features_html}
                            </ul>
                        </div>
                        <p style="text-align: center;">
                            <a href="{dashboard_link}" class="button">Go to Dashboard</a>
                        </p>
                        <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                            Need help? Check out our <a href="#">Getting Started Guide</a> or contact support.
                        </p>
                    </div>
                    <div class="footer">
                        <p>© 2025 LearnTrack. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
            """

            result = EmailService._send_with_plunk(
                to_email=to_email,
                subject=subject,
                html_body=html_body,
                category="welcome",
            )
            return result.delivered

        except Exception as e:
            logger.error(
                "Failed to build welcome email", recipient=to_email, error=str(e)
            )
            return False

    @staticmethod
    def send_assignment_notification(
        to_email: str,
        to_name: str,
        assignment_title: str,
        teacher_name: str,
        due_date: datetime,
        assignment_link: str,
    ) -> bool:
        """
        Send notification about new assignment

        Args:
            to_email: Student email
            to_name: Student name
            assignment_title: Assignment title
            teacher_name: Teacher name
            due_date: Assignment due date
            assignment_link: Link to assignment

        Returns:
            bool: True if email sent successfully
        """
        try:
            subject = f"New Assignment: {assignment_title}"
            due_date_str = due_date.strftime("%B %d, %Y at %I:%M %p")

            html_body = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: linear-gradient(135deg, #3b82f6 0%, #9333ea 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }}
                    .button {{ display: inline-block; background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
                    .assignment-box {{ background: white; padding: 20px; border-radius: 6px; border-left: 4px solid #3b82f6; margin: 20px 0; }}
                    .footer {{ text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📝 New Assignment</h1>
                    </div>
                    <div class="content">
                        <p>Hi {to_name},</p>
                        <p><strong>{teacher_name}</strong> has assigned you a new assignment.</p>
                        <div class="assignment-box">
                            <h3>{assignment_title}</h3>
                            <p><strong>Due:</strong> {due_date_str}</p>
                        </div>
                        <p style="text-align: center;">
                            <a href="{assignment_link}" class="button">View Assignment</a>
                        </p>
                    </div>
                    <div class="footer">
                        <p>© 2025 LearnTrack. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
            """

            result = EmailService._send_with_plunk(
                to_email=to_email,
                subject=subject,
                html_body=html_body,
                category="assignment_notification",
            )
            return result.delivered

        except Exception as e:
            logger.error(
                "Failed to build assignment notification email",
                recipient=to_email,
                error=str(e),
            )
            return False

    @staticmethod
    def send_deadline_reminder(
        to_email: str,
        to_name: str,
        assignment_title: str,
        due_date: datetime,
        assignment_link: str,
        hours_remaining: int,
    ) -> bool:
        """Send reminder about upcoming assignment deadline"""
        try:
            subject = f"Reminder: {assignment_title} due soon"
            due_date_str = due_date.strftime("%B %d, %Y at %I:%M %p")

            urgency_message = ""
            if hours_remaining <= 24:
                urgency_message = f"⚠️ Only {hours_remaining} hours remaining!"
            else:
                days_remaining = hours_remaining // 24
                urgency_message = f"📅 {days_remaining} days remaining"

            html_body = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }}
                    .button {{ display: inline-block; background: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
                    .reminder-box {{ background: #fef3c7; padding: 20px; border-radius: 6px; border-left: 4px solid #f59e0b; margin: 20px 0; }}
                    .footer {{ text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>⏰ Assignment Due Soon</h1>
                    </div>
                    <div class="content">
                        <p>Hi {to_name},</p>
                        <p>This is a friendly reminder about your upcoming assignment deadline.</p>
                        <div class="reminder-box">
                            <h3>{assignment_title}</h3>
                            <p><strong>Due:</strong> {due_date_str}</p>
                            <p style="font-size: 18px; font-weight: bold; color: #f59e0b;">{urgency_message}</p>
                        </div>
                        <p style="text-align: center;">
                            <a href="{assignment_link}" class="button">Complete Assignment</a>
                        </p>
                    </div>
                    <div class="footer">
                        <p>© 2025 LearnTrack. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
            """

            result = EmailService._send_with_plunk(
                to_email=to_email,
                subject=subject,
                html_body=html_body,
                category="deadline_reminder",
            )
            return result.delivered

        except Exception as e:
            logger.error(
                "Failed to build deadline reminder email",
                recipient=to_email,
                error=str(e),
            )
            return False

    @staticmethod
    def send_direct_message_email(
        to_email: str,
        to_name: str,
        from_name: str,
        subject: str,
        content: str,
    ) -> EmailDeliveryResult:
        """Send a direct tutor message over email and report delivery status."""
        try:
            safe_content = (content or "").replace("\n", "<br>")
            html_body = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2 style="margin:0;">New message from {from_name}</h2>
                    </div>
                    <div class="content">
                        <p>Hi {to_name},</p>
                        <p>{safe_content}</p>
                    </div>
                </div>
            </body>
            </html>
            """

            return EmailService._send_with_plunk(
                to_email=to_email,
                subject=subject,
                html_body=html_body,
                category="direct_message",
            )
        except Exception as e:
            logger.error(
                "Failed to build direct message email",
                recipient=to_email,
                error=str(e),
            )
            return EmailDeliveryResult(
                delivered=False,
                provider="plunk",
                error=str(e),
            )


# Convenience functions
email_service = EmailService()
