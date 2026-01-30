"""
Phase 2: Core Learning Flow Testing Script
Tests: Subjects → Questions → Assignments → Progress
"""

import asyncio
import httpx
import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
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


async def test_subject_management():
    """Test 2.1: Subject & Topic Management"""
    logger.info("=" * 60)
    logger.info("TEST 2.1: Subject & Topic Management (No Auth)")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /subjects/ (should require auth)
        try:
            response = await client.get(f"{API_URL}/subjects/", timeout=10.0)
            log_test(
                "GET /subjects/ (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("GET /subjects/", False, str(e))

        # Test POST /subjects/ (should require auth)
        try:
            response = await client.post(
                f"{API_URL}/subjects/",
                json={"name": "Test Subject", "description": "Test"},
                timeout=10.0,
            )
            log_test(
                "POST /subjects/ (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("POST /subjects/", False, str(e))


async def test_question_management():
    """Test 2.2: Question Bank Management"""
    logger.info("=" * 60)
    logger.info("TEST 2.2: Question Bank Management (No Auth)")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /questions/ (should require auth)
        try:
            response = await client.get(f"{API_URL}/questions/", timeout=10.0)
            log_test(
                "GET /questions/ (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("GET /questions/", False, str(e))

        # Test POST /questions/ (should require auth)
        try:
            response = await client.post(
                f"{API_URL}/questions/",
                json={
                    "question_text": "What is 2+2?",
                    "question_type": "multiple-choice",
                    "difficulty": "easy",
                    "points": 5,
                },
                timeout=10.0,
            )
            log_test(
                "POST /questions/ (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("POST /questions/", False, str(e))


async def test_assignment_management():
    """Test 2.3: Assignment Creation & Distribution"""
    logger.info("=" * 60)
    logger.info("TEST 2.3: Assignment Management (No Auth)")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /assignments/ (should require auth)
        try:
            response = await client.get(f"{API_URL}/assignments/", timeout=10.0)
            log_test(
                "GET /assignments/ (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("GET /assignments/", False, str(e))

        # Test POST /assignments/ (should require auth)
        try:
            response = await client.post(
                f"{API_URL}/assignments/",
                json={
                    "title": "Test Assignment",
                    "description": "Test",
                    "subject_id": "test-subject-id",
                    "student_ids": ["student-1"],
                    "total_points": 100,
                },
                timeout=10.0,
            )
            log_test(
                "POST /assignments/ (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("POST /assignments/", False, str(e))


async def test_progress_tracking():
    """Test 2.4: Progress Tracking Endpoints"""
    logger.info("=" * 60)
    logger.info("TEST 2.4: Progress Tracking (No Auth)")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /progress/assignment/{id} (should require auth)
        try:
            response = await client.get(
                f"{API_URL}/progress/assignment/test-assignment-id", timeout=10.0
            )
            log_test(
                "GET /progress/assignment/{id} (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("GET progress by assignment", False, str(e))

        # Test POST answer (should require auth)
        try:
            response = await client.post(
                f"{API_URL}/progress/assignment/test-id/answer",
                json={"question_id": "q1", "answer": "4"},
                timeout=10.0,
            )
            log_test(
                "POST /progress/assignment/{id}/answer (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code}",
            )
        except Exception as e:
            log_test("POST answer", False, str(e))


async def test_api_structure():
    """Test 2.5: Verify API Structure and Endpoints"""
    logger.info("=" * 60)
    logger.info("TEST 2.5: API Structure Verification")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Get OpenAPI spec
        try:
            response = await client.get(f"{BASE_URL}/openapi.json", timeout=10.0)
            if response.status_code == 200:
                spec = response.json()
                paths = spec.get("paths", {})

                # Check for core learning flow endpoints
                core_endpoints = [
                    "/api/v1/subjects/",
                    "/api/v1/questions/",
                    "/api/v1/assignments/",
                    "/api/v1/progress/",
                    "/api/v1/topics/",
                    "/api/v1/groups/",
                    "/api/v1/students/",
                ]

                found_count = 0
                for endpoint in core_endpoints:
                    # Check if endpoint or variants exist
                    if endpoint in paths or endpoint.rstrip("/") in paths:
                        found_count += 1
                        log_test(f"Endpoint {endpoint}", True, "Found in API spec")
                    else:
                        # Check for parameterized variants
                        found_variant = any(
                            path.startswith(endpoint.rstrip("/"))
                            for path in paths.keys()
                        )
                        if found_variant:
                            found_count += 1
                            log_test(
                                f"Endpoint {endpoint}", True, "Found (with variants)"
                            )
                        else:
                            log_test(f"Endpoint {endpoint}", False, "Not found")

                logger.info(f"Found {found_count}/{len(core_endpoints)} core endpoints")
            else:
                log_test(
                    "OpenAPI spec retrieval", False, f"Status: {response.status_code}"
                )
        except Exception as e:
            log_test("API structure verification", False, str(e))


async def generate_test_report():
    """Generate final test report"""
    logger.info("\n" + "=" * 80)
    logger.info("PHASE 2: CORE LEARNING FLOW TEST REPORT")
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
    logger.info("STARTING PHASE 2: CORE LEARNING FLOW TESTS")
    logger.info("=" * 80)
    logger.info(f"Testing against: {BASE_URL}")
    logger.info(
        "Note: These tests verify endpoint protection (all should require auth)"
    )
    logger.info("=" * 80 + "\n")

    # Run all tests
    await test_subject_management()
    await test_question_management()
    await test_assignment_management()
    await test_progress_tracking()
    await test_api_structure()

    # Generate report
    report = await generate_test_report()

    # Save report to file
    report_file = "phase2_learning_flow_report.json"
    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)
    logger.info(f"\nReport saved to: {report_file}")

    return report


if __name__ == "__main__":
    asyncio.run(main())
