"""
Enhanced Clerk Authentication for Backend-First Architecture
Handles JWT validation, user context extraction, and role-based access control
"""

import asyncio
import jwt
import httpx
import json
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import structlog
from pydantic import BaseModel, EmailStr
from cachetools import TTLCache

from app.core.config import settings
from app.models.user import UserRole, AdminPermission
from app.core.database import get_database

logger = structlog.get_logger()

# Cache for user sync status - avoids syncing on every request
# Key: clerk_id, Value: last sync timestamp
# TTL of 5 minutes means we'll re-sync at most once every 5 minutes per user
_user_sync_cache: TTLCache = TTLCache(maxsize=10000, ttl=300)

# Cache for failed Clerk API calls to avoid spamming logs
# Key: user_id, Value: (failure_count, last_failure_time)
# After 5 failures, we stop trying for 1 hour
_clerk_api_failure_cache: Dict[str, tuple] = {}


class ClerkUserContext(BaseModel):
    """Enhanced user context from Clerk JWT"""

    user_id: str
    clerk_id: str
    email: Optional[EmailStr] = None  # Made optional since it might not be in JWT
    name: Optional[str] = "Unknown"  # Made optional with default
    role: UserRole
    roles: List[UserRole] = []
    permissions: List[str] = ["read"]
    session_id: Optional[str] = None
    organization_id: Optional[str] = None
    created_at: Optional[datetime] = None
    last_sign_in: Optional[datetime] = None
    tutor_id: str  # Tutor ID for tenant isolation - for tutors: their own clerk_id, for others: their tutor's clerk_id
    student_ids: List[str] = []  # For parents: list of student IDs they can access

    # Super admin fields
    is_super_admin: bool = False
    admin_permissions: List[AdminPermission] = []

    @property
    def auth0_id(self) -> str:
        """Backward compatibility property - returns clerk_id"""
        return self.clerk_id

    @property
    def has_full_admin_access(self) -> bool:
        """Check if user has full admin access"""
        return (
            self.is_super_admin
            and AdminPermission.FULL_ACCESS in self.admin_permissions
        )

    def has_admin_permission(self, permission: AdminPermission) -> bool:
        """Check if user has a specific admin permission"""
        if not self.is_super_admin:
            return False
        if AdminPermission.FULL_ACCESS in self.admin_permissions:
            return True
        return permission in self.admin_permissions


class EnhancedClerkJWTBearer:
    """Enhanced Clerk JWT Bearer for backend-first authentication"""

    def __init__(self):
        self.clerk_secret = settings.CLERK_SECRET_KEY
        self.clerk_publishable_key = settings.CLERK_PUBLISHABLE_KEY
        self.issuer = settings.CLERK_JWT_ISSUER or self._construct_issuer()
        self._jwks_cache: Optional[Dict] = None
        self._cache_expiry: Optional[datetime] = None

    def _construct_issuer(self) -> Optional[str]:
        """Return None and warn if CLERK_JWT_ISSUER is not configured."""
        if self.clerk_publishable_key:
            logger.warning(
                "CLERK_JWT_ISSUER is not set; set it to your Clerk instance URL"
            )
        return None

    async def get_jwks(self) -> Dict:
        """Get JSON Web Key Set from Clerk with caching"""
        current_time = datetime.now(timezone.utc)

        if not self.issuer:
            logger.error("CLERK_JWT_ISSUER is not set")
            return {}

        # Check cache validity (refresh every hour)
        if (
            self._jwks_cache
            and self._cache_expiry
            and current_time < self._cache_expiry
        ):
            return self._jwks_cache

        try:
            # Construct JWKS URL based on Clerk instance
            jwks_url = f"{self.issuer}/.well-known/jwks.json"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(jwks_url)
                response.raise_for_status()

                jwks_data = response.json()

                # Cache the JWKS data
                self._jwks_cache = jwks_data
                self._cache_expiry = current_time + timedelta(hours=1)

                logger.info("JWKS fetched successfully", url=jwks_url)
                return jwks_data

        except Exception as e:
            logger.error("Failed to fetch JWKS", error=str(e))
            # Fallback to direct secret validation if JWKS fails
            return {}

    async def verify_token(self, token: str) -> ClerkUserContext:
        """Verify Clerk JWT token and extract user context"""
        try:
            # Development mode fallback
            if token == "dev_token" and settings.ENVIRONMENT == "development":
                return self._create_dev_user_context()

            # Try JWKS verification first (RS256)
            try:
                jwks = await self.get_jwks()
                if jwks and "keys" in jwks:
                    # Decode header to get key ID
                    unverified_header = jwt.get_unverified_header(token)
                    kid = unverified_header.get("kid")

                    # Find matching key
                    key = None
                    for jwk in jwks["keys"]:
                        if jwk.get("kid") == kid:
                            key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
                            break

                    if key:
                        payload = jwt.decode(
                            token,
                            key,
                            algorithms=["RS256"],
                            issuer=self.issuer,
                            options={"verify_exp": True, "verify_aud": False},
                            leeway=60,  # Allow 60 seconds clock skew tolerance
                        )
                        return await self._extract_user_context(payload)
                    else:
                        logger.warning("No matching key found in JWKS", kid=kid)

            except jwt.InvalidTokenError as jwks_error:
                logger.warning("JWKS verification failed", error=str(jwks_error))
            except Exception as jwks_error:
                logger.warning("JWKS verification error", error=str(jwks_error))

            # Don't try HS256 fallback - Clerk uses RS256
            # If JWKS fails, the token is invalid
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
            )

        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired"
            )
        except jwt.InvalidTokenError as e:
            logger.error("Invalid JWT token", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
            )
        except HTTPException:
            # Re-raise HTTP exceptions
            raise
        except Exception as e:
            logger.error("Token verification failed", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication service error",
            )

    async def _fetch_user_from_clerk(self, user_id: str) -> Dict[str, Any]:
        """Fetch user data from Clerk API with circuit breaker and retry logic"""
        from datetime import datetime, timedelta

        # Check if we're in a circuit breaker state (too many recent failures)
        current_time = datetime.now(timezone.utc)
        if user_id in _clerk_api_failure_cache:
            failure_count, last_failure_time = _clerk_api_failure_cache[user_id]
            # If we've failed 5+ times in the last hour, stop trying
            if failure_count >= 5 and (current_time - last_failure_time) < timedelta(
                hours=1
            ):
                logger.debug(
                    "Skipping Clerk API call due to circuit breaker",
                    user_id=user_id,
                    failure_count=failure_count,
                )
                return {}
            # Reset after 1 hour
            elif (current_time - last_failure_time) >= timedelta(hours=1):
                del _clerk_api_failure_cache[user_id]

        # Retry logic with exponential backoff
        max_retries = 3
        base_delay = 1.0  # seconds

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        f"https://api.clerk.com/v1/users/{user_id}",
                        headers={
                            "Authorization": f"Bearer {self.clerk_secret}",
                            "Content-Type": "application/json",
                        },
                        timeout=10.0,
                    )

                    if response.status_code == 200:
                        # Success! Clear any failure cache
                        if user_id in _clerk_api_failure_cache:
                            del _clerk_api_failure_cache[user_id]
                        return response.json()
                    else:
                        logger.warning(
                            "Failed to fetch user from Clerk",
                            status=response.status_code,
                            user_id=user_id,
                        )
                        return {}

            except httpx.NetworkError as e:
                # Network errors (DNS, connection issues) - retry with backoff
                if attempt < max_retries - 1:
                    delay = base_delay * (2**attempt)  # Exponential backoff: 1s, 2s, 4s
                    logger.warning(
                        "Network error fetching user from Clerk, retrying...",
                        user_id=user_id,
                        attempt=attempt + 1,
                        max_retries=max_retries,
                        delay=delay,
                        error=str(e),
                    )
                    await asyncio.sleep(delay)
                    continue
                else:
                    # Final attempt failed - log once and cache the failure
                    _clerk_api_failure_cache[user_id] = (
                        _clerk_api_failure_cache.get(user_id, (0, current_time))[0] + 1,
                        current_time,
                    )
                    # Only log error if it's the first time or every 10 failures
                    failure_count = _clerk_api_failure_cache[user_id][0]
                    if failure_count == 1 or failure_count % 10 == 0:
                        logger.error(
                            "Network error fetching user from Clerk (retries exhausted)",
                            user_id=user_id,
                            failure_count=failure_count,
                            error=str(e),
                        )
                    return {}

            except Exception as e:
                # Other errors - log once per user per hour to avoid spam
                _clerk_api_failure_cache[user_id] = (
                    _clerk_api_failure_cache.get(user_id, (0, current_time))[0] + 1,
                    current_time,
                )
                failure_count = _clerk_api_failure_cache[user_id][0]
                if failure_count == 1 or failure_count % 10 == 0:
                    logger.error(
                        "Error fetching user from Clerk",
                        user_id=user_id,
                        failure_count=failure_count,
                        error=str(e),
                    )
                return {}

        return {}

    async def _extract_user_context(self, payload: Dict[str, Any]) -> ClerkUserContext:
        """Extract user context from JWT payload"""
        try:
            # Extract basic user information from JWT
            user_id = payload.get("sub")
            if not user_id:
                raise ValueError("Missing user ID in token")

            # JWT might not have email/name, so fetch from Clerk API
            email = payload.get("email")
            name = payload.get("name", payload.get("given_name"))
            metadata = payload.get("public_metadata", {})

            # Fetch user from database once - we'll need it for both missing data and super admin checks
            db_user = await self._get_user_from_database(user_id)

            # If email or name is missing, use database data first before calling Clerk API
            if db_user and (not email or not name or not metadata):
                email = email or db_user.get("email")
                name = name or db_user.get("name")
                metadata = metadata or db_user.get("public_metadata", {})
                logger.debug("Filled missing user data from database", user_id=user_id)

            # Only call Clerk API if still missing data
            if not email or not name or not metadata:
                logger.info("Fetching user data from Clerk API", user_id=user_id)
                user_data = await self._fetch_user_from_clerk(user_id)

                if user_data:
                    email = email or user_data.get("email_addresses", [{}])[0].get(
                        "email_address"
                    )
                    name = (
                        name
                        or f"{user_data.get('first_name', '')} {user_data.get('last_name', '')}".strip()
                        or "Unknown"
                    )
                    metadata = metadata or user_data.get("public_metadata", {})

            # Ensure we have at least basic info
            email = email or f"{user_id}@placeholder.com"  # Fallback email
            name = name or "Unknown User"

            # Extract role from metadata
            role_str = metadata.get("role", "tutor")  # Default to tutor for now

            # Convert role string to UserRole enum
            try:
                role = UserRole(role_str.lower())
            except ValueError:
                role = UserRole.TUTOR  # Default to tutor
                logger.warning(
                    "Invalid role in metadata, defaulting to tutor",
                    role=role_str,
                    user_id=user_id,
                )

            # Extract additional roles if present
            roles = metadata.get("roles", [role_str])
            role_enums = []
            for r in roles:
                try:
                    role_enums.append(UserRole(r.lower()))
                except ValueError:
                    continue

            if not role_enums:
                role_enums = [role]

            # Set permissions based on role
            permissions = self._get_role_permissions(role)

            # Check for super admin status from JWT metadata first
            is_super_admin = (
                metadata.get("is_super_admin", False) or role == UserRole.SUPER_ADMIN
            )
            admin_permissions_raw = metadata.get("admin_permissions", [])
            admin_permissions = []
            for perm in admin_permissions_raw:
                try:
                    admin_permissions.append(AdminPermission(perm))
                except ValueError:
                    logger.warning("Invalid admin permission", permission=perm)

            # Check database for super admin status (database overrides JWT)
            # db_user was already fetched earlier, reuse it here
            if db_user:
                # Override with database values if they exist
                if db_user.get("is_super_admin"):
                    is_super_admin = True
                if db_user.get("role") == "super_admin":
                    role = UserRole.SUPER_ADMIN
                    is_super_admin = True
                db_admin_perms = db_user.get("admin_permissions", [])
                if db_admin_perms:
                    admin_permissions = []
                    for perm in db_admin_perms:
                        try:
                            admin_permissions.append(
                                AdminPermission(
                                    perm.lower() if isinstance(perm, str) else perm
                                )
                            )
                        except ValueError:
                            logger.warning(
                                "Invalid admin permission from DB", permission=perm
                            )

            # If super admin role but no permissions specified, grant full access
            if is_super_admin and not admin_permissions:
                admin_permissions = [AdminPermission.FULL_ACCESS]

            # Set tutor_id based on role
            if role == UserRole.TUTOR or role == UserRole.SUPER_ADMIN:
                tutor_id = user_id  # Tutors and super admins use their own clerk_id as tutor_id
            else:
                # For students and parents, we'll need to look up their tutor_id from the database
                # For now, use a placeholder - this will be set by _sync_user_to_database
                tutor_id = (
                    db_user.get("tutor_id", "placeholder") if db_user else "placeholder"
                )

            # Create user context
            user_context = ClerkUserContext(
                user_id=user_id,
                clerk_id=user_id,
                email=email,
                name=name,
                role=role,
                roles=role_enums,
                permissions=permissions,
                session_id=payload.get("sid"),
                organization_id=payload.get("org_id"),
                created_at=datetime.fromtimestamp(
                    payload.get("iat", 0), tz=timezone.utc
                ),
                last_sign_in=datetime.now(timezone.utc),
                tutor_id=tutor_id,
                student_ids=db_user.get("student_ids", []) if db_user else [],
                is_super_admin=is_super_admin,
                admin_permissions=admin_permissions,
            )

            # Sync user with database
            await self._sync_user_to_database(user_context)

            return user_context

        except Exception as e:
            logger.error(
                "Failed to extract user context", error=str(e), payload=payload
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload"
            )

    def _get_role_permissions(self, role: UserRole) -> List[str]:
        """Get permissions based on user role"""
        permission_map = {
            UserRole.TUTOR: ["read", "write", "create", "delete", "manage_students"],
            UserRole.STUDENT: ["read", "write_own", "submit"],
            UserRole.PARENT: ["read", "view_children"],
            UserRole.SUPER_ADMIN: [
                "read",
                "write",
                "create",
                "delete",
                "manage_students",
                "admin",
                "manage_system",
            ],
        }
        return permission_map.get(role, ["read"])

    async def _get_user_from_database(self, clerk_id: str) -> Optional[dict]:
        """Get user from database by clerk_id to check for super admin status"""
        try:
            db = await get_database()

            # Check all role collections for the user
            collections = ["tutors", "students", "parents"]
            for collection_name in collections:
                collection = db[collection_name]
                user = await collection.find_one({"clerk_id": clerk_id})
                if user:
                    return user

            return None
        except Exception as e:
            logger.error(
                "Failed to get user from database", error=str(e), clerk_id=clerk_id
            )
            return None

    async def _sync_user_to_database(
        self, user_context: ClerkUserContext, force: bool = False
    ):
        """Sync user information to database with caching to avoid syncing on every request"""
        try:
            # Check if we've recently synced this user (within TTL)
            cache_key = user_context.clerk_id
            if not force and cache_key in _user_sync_cache:
                logger.debug(
                    "Skipping user sync (cached)", user_id=user_context.user_id
                )
                return

            # Import here to avoid circular import
            from app.services.user_service import UserService

            db = await get_database()
            user_service = UserService(db)

            # Check if user exists
            existing_user = await user_service.get_user_by_clerk_id(
                user_context.clerk_id
            )

            if not existing_user:
                # Create new user - always sync new users
                await user_service.create_user_from_clerk(user_context)
                logger.info("Created new user from Clerk", user_id=user_context.user_id)
            else:
                # Update existing user
                await user_service.update_user_from_clerk(user_context)
                logger.debug(
                    "Updated existing user from Clerk", user_id=user_context.user_id
                )

            # Mark user as synced in cache
            _user_sync_cache[cache_key] = datetime.now(timezone.utc)

        except Exception as e:
            logger.error("Failed to sync user to database", error=str(e))
            # Don't fail authentication if database sync fails

    # def _create_dev_user_context(self) -> ClerkUserContext:
    #     """Create development user context for testing"""
    #     return ClerkUserContext(
    #         user_id="dev_user_123",
    #         clerk_id="dev_user_123",
    #         email="dev@test.com",
    #         name="Development User",
    #         role=UserRole.TUTOR,
    #         roles=[UserRole.TUTOR],
    #         permissions=["read", "write", "create", "delete", "manage_students"],
    #         session_id="dev_session",
    #         created_at=datetime.now(timezone.utc),
    #         last_sign_in=datetime.now(timezone.utc),
    #         tutor_id="dev_user_123",  # Dev user is a tutor, so uses own clerk_id
    #         student_ids=[]
    #     )


# Global instance
enhanced_clerk_bearer = EnhancedClerkJWTBearer()
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> ClerkUserContext:
    """Get current authenticated user from JWT token"""
    token = credentials.credentials
    return await enhanced_clerk_bearer.verify_token(token)


async def require_authenticated_user(
    current_user: ClerkUserContext = Depends(get_current_user),
) -> ClerkUserContext:
    """Require authenticated user"""
    return current_user


async def require_tutor(
    current_user: ClerkUserContext = Depends(get_current_user),
) -> ClerkUserContext:
    """Require tutor role (super admins also have access)"""
    if current_user.role != UserRole.TUTOR and not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Tutor access required"
        )
    return current_user


async def require_student(
    current_user: ClerkUserContext = Depends(get_current_user),
) -> ClerkUserContext:
    """Require student role"""
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Student access required"
        )
    return current_user


async def require_parent(
    current_user: ClerkUserContext = Depends(get_current_user),
) -> ClerkUserContext:
    """Require parent role"""
    if current_user.role != UserRole.PARENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Parent access required"
        )
    return current_user


async def require_role(allowed_roles: List[UserRole]):
    """Factory function to require specific roles"""

    async def role_checker(
        current_user: ClerkUserContext = Depends(get_current_user),
    ) -> ClerkUserContext:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[r.value for r in allowed_roles]}",
            )
        return current_user

    return role_checker


# Super Admin Dependencies
async def require_super_admin(
    current_user: ClerkUserContext = Depends(get_current_user),
) -> ClerkUserContext:
    """Require super admin role"""
    if not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required"
        )
    return current_user


def require_admin_permission(permission: AdminPermission):
    """Factory function to require specific admin permission"""

    async def permission_checker(
        current_user: ClerkUserContext = Depends(require_super_admin),
    ) -> ClerkUserContext:
        if not current_user.has_admin_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing admin permission: {permission.value}",
            )
        return current_user

    return permission_checker


async def require_tutor_or_super_admin(
    current_user: ClerkUserContext = Depends(get_current_user),
) -> ClerkUserContext:
    """Require tutor role or super admin"""
    if current_user.role != UserRole.TUTOR and not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tutor or super admin access required",
        )
    return current_user
