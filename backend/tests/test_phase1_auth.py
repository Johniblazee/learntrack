"""
Phase 1: Authentication & User Management Testing Script
Tests all authentication flows and user management features
"""

import asyncio
import httpx
import json
from datetime import datetime
from typing import Dict, Any, Optional
import structlog

logger = structlog.get_logger()

# Test Configuration
BASE_URL = "http://localhost:8000"
API_URL = f"{BASE_URL}/api/v1"

# Test Results Storage
test_results = []


def log_test(test_name: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "PASS" if passed else "FAIL"
    test_results.append(
        {
            "test": test_name,
            "passed": passed,
            "details": details,
            "timestamp": datetime.now().isoformat(),
        }
    )
    logger.info(f"[{status}] {test_name}", details=details)
    return passed


async def test_health_endpoints():
    """Test 1.1: Health Check Endpoints (No Auth Required)"""
    logger.info("=" * 60)
    logger.info("TEST 1.1: Health Check Endpoints")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test /health (Liveness probe)
        try:
            response = await client.get(f"{BASE_URL}/health", timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                log_test(
                    "/health endpoint",
                    data.get("status") == "healthy",
                    f"Status: {data.get('status')}, Service: {data.get('service')}",
                )
            else:
                log_test("/health endpoint", False, f"Status: {response.status_code}")
        except Exception as e:
            log_test("/health endpoint", False, str(e))

        # Test /health/ready (Readiness probe)
        try:
            response = await client.get(f"{BASE_URL}/health/ready", timeout=10.0)
            log_test(
                "/health/ready endpoint",
                response.status_code == 200,
                f"Status: {response.status_code}",
            )
            if response.status_code == 200:
                logger.info("Readiness check passed", data=response.json())
        except Exception as e:
            log_test("/health/ready endpoint", False, str(e))

        # Test /metrics (Monitoring)
        try:
            response = await client.get(f"{BASE_URL}/metrics", timeout=10.0)
            log_test(
                "/metrics endpoint",
                response.status_code == 200,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("/metrics endpoint", False, str(e))


async def test_api_docs():
    """Test 1.2: API Documentation Availability"""
    logger.info("=" * 60)
    logger.info("TEST 1.2: API Documentation")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test Swagger UI
        try:
            response = await client.get(f"{BASE_URL}/docs", timeout=10.0)
            log_test(
                "Swagger UI (/docs)",
                response.status_code == 200,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("Swagger UI", False, str(e))

        # Test ReDoc
        try:
            response = await client.get(f"{BASE_URL}/redoc", timeout=10.0)
            log_test(
                "ReDoc (/redoc)",
                response.status_code == 200,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("ReDoc", False, str(e))

        # Test OpenAPI JSON
        try:
            response = await client.get(f"{BASE_URL}/openapi.json", timeout=10.0)
            if response.status_code == 200:
                openapi_data = response.json()
                paths_count = len(openapi_data.get("paths", {}))
                log_test(
                    "OpenAPI Specification",
                    True,
                    f"Status: 200, {paths_count} endpoints documented",
                )
            else:
                log_test(
                    "OpenAPI Specification", False, f"Status: {response.status_code}"
                )
        except Exception as e:
            log_test("OpenAPI Specification", False, str(e))


async def test_unauthorized_access():
    """Test 1.3: Unauthorized Access Protection"""
    logger.info("=" * 60)
    logger.info("TEST 1.3: Unauthorized Access Protection")
    logger.info("=" * 60)

    protected_endpoints = [
        ("GET", f"{API_URL}/users/me"),
        ("GET", f"{API_URL}/students/"),
        ("GET", f"{API_URL}/assignments/"),
        ("GET", f"{API_URL}/subjects/"),
        ("POST", f"{API_URL}/questions/"),
    ]

    async with httpx.AsyncClient() as client:
        for method, url in protected_endpoints:
            try:
                if method == "GET":
                    response = await client.get(url, timeout=10.0)
                else:
                    response = await client.post(url, timeout=10.0)

                # Should return 401 or 403
                passed = response.status_code in [401, 403]
                log_test(
                    f"{method} {url.split('/')[-1]} (no auth)",
                    passed,
                    f"Status: {response.status_code} (expected 401/403)",
                )
            except Exception as e:
                log_test(f"{method} {url.split('/')[-1]}", False, str(e))


async def test_invalid_tokens():
    """Test 1.4: Invalid Token Handling"""
    logger.info("=" * 60)
    logger.info("TEST 1.4: Invalid Token Handling")
    logger.info("=" * 60)

    test_cases = [
        ("No token", {}),
        ("Empty token", {"Authorization": "Bearer "}),
        ("Invalid token", {"Authorization": "Bearer invalid_token"}),
        ("Malformed header", {"Authorization": "Invalid"}),
    ]

    async with httpx.AsyncClient() as client:
        for test_name, headers in test_cases:
            try:
                response = await client.get(
                    f"{API_URL}/users/me", headers=headers, timeout=10.0
                )
                # All should fail with 401/403
                passed = response.status_code in [401, 403]
                log_test(f"{test_name}", passed, f"Status: {response.status_code}")
            except Exception as e:
                log_test(f"{test_name}", False, str(e))


async def generate_test_report():
    """Generate final test report"""
    logger.info("\n" + "=" * 80)
    logger.info("PHASE 1: AUTHENTICATION TEST REPORT")
    logger.info("=" * 80)

    total_tests = len(test_results)
    passed_tests = sum(1 for r in test_results if r["passed"])
    failed_tests = total_tests - passed_tests

    logger.info(f"Total Tests: {total_tests}")
    logger.info(f"Passed: {passed_tests}")
    logger.info(f"Failed: {failed_tests}")
    logger.info(
        f"Success Rate: {(passed_tests / total_tests * 100):.1f}%"
        if total_tests > 0
        else "N/A"
    )

    if failed_tests > 0:
        logger.info("\nFAILED TESTS:")
        logger.info("-" * 80)
        for result in test_results:
            if not result["passed"]:
                logger.info(f"- {result['test']}: {result['details']}")

    logger.info("\n" + "=" * 80)

    return {
        "total": total_tests,
        "passed": passed_tests,
        "failed": failed_tests,
        "success_rate": (passed_tests / total_tests * 100) if total_tests > 0 else 0,
        "results": test_results,
    }


async def main():
    """Main test runner"""
    logger.info("\n" + "=" * 80)
    logger.info("STARTING PHASE 1: AUTHENTICATION & USER MANAGEMENT TESTS")
    logger.info("=" * 80)
    logger.info(f"Testing against: {BASE_URL}")
    logger.info("=" * 80 + "\n")

    # Run all tests
    await test_health_endpoints()
    await test_api_docs()
    await test_unauthorized_access()
    await test_invalid_tokens()

    # Generate report
    report = await generate_test_report()

    # Save report to file
    report_file = "phase1_auth_test_report.json"
    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)
    logger.info(f"\nReport saved to: {report_file}")

    return report


if __name__ == "__main__":
    asyncio.run(main())
