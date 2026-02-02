"""
Email service using Plunk for sending transactional emails
"""

from typing import Optional, Dict, Any, List
import os
from datetime import datetime

# Initialize Plunk client
PLUNK_API_KEY = os.getenv("PLUNK_API_KEY", "")

# Try to import Plunk, but don't fail if not available
try:
    import plunk

    plunk_client = plunk.Plunk(PLUNK_API_KEY) if PLUNK_API_KEY else None
except (ImportError, AttributeError):
    plunk_client = None


class EmailService:
    """Service for sending emails via Plunk"""

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
        if not plunk_client:
            print(f"[EMAIL] Would send invitation to {to_email} (Plunk not configured)")
            return False

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

            plunk_client.emails.send(to=to_email, subject=subject, body=html_body)

            print(f"[EMAIL] Invitation sent to {to_email}")
            return True

        except Exception as e:
            print(f"[EMAIL] Failed to send invitation to {to_email}: {str(e)}")
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
        if not plunk_client:
            print(
                f"[EMAIL] Would send welcome email to {to_email} (Plunk not configured)"
            )
            return False

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

            plunk_client.emails.send(to=to_email, subject=subject, body=html_body)

            print(f"[EMAIL] Welcome email sent to {to_email}")
            return True

        except Exception as e:
            print(f"[EMAIL] Failed to send welcome email to {to_email}: {str(e)}")
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
        if not plunk_client:
            print(
                f"[EMAIL] Would send assignment notification to {to_email} (Plunk not configured)"
            )
            return False

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

            plunk_client.emails.send(to=to_email, subject=subject, body=html_body)

            print(f"[EMAIL] Assignment notification sent to {to_email}")
            return True

        except Exception as e:
            print(
                f"[EMAIL] Failed to send assignment notification to {to_email}: {str(e)}"
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
        if not plunk_client:
            print(
                f"[EMAIL] Would send deadline reminder to {to_email} (Plunk not configured)"
            )
            return False

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

            plunk_client.emails.send(to=to_email, subject=subject, body=html_body)

            print(f"[EMAIL] Deadline reminder sent to {to_email}")
            return True

        except Exception as e:
            print(f"[EMAIL] Failed to send deadline reminder to {to_email}: {str(e)}")
            return False


# Convenience functions
email_service = EmailService()
