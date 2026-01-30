"""
Phase 3: AI Features Testing Script (Corrected)
Tests: Question Generation, RAG Integration, Cost Tracking
Location: tests/phase3_ai_features.py
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


async def test_question_generator_endpoints():
    """Test 3.1: AI Question Generator Endpoints"""
    logger.info("=" * 60)
    logger.info("TEST 3.1: AI Question Generator Endpoints")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /question-generator/sessions
        try:
            response = await client.get(
                f"{API_URL}/question-generator/sessions", timeout=10.0
            )
            log_test(
                "GET /question-generator/sessions (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /question-generator/sessions", False, str(e))

        # Test POST /question-generator/generate (generate from text)
        try:
            response = await client.post(
                f"{API_URL}/question-generator/generate",
                json={
                    "text_content": "Photosynthesis is the process by which plants convert light energy into chemical energy.",
                    "subject": "Biology",
                    "topic": "Photosynthesis",
                    "question_count": 5,
                    "difficulty": "medium",
                    "question_types": ["multiple-choice"],
                    "preferred_provider": "openai",
                },
                timeout=10.0,
            )
            log_test(
                "POST /question-generator/generate (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("POST question-generator/generate", False, str(e))

        # Test GET /question-generator/available-models
        try:
            response = await client.get(
                f"{API_URL}/question-generator/available-models", timeout=10.0
            )
            log_test(
                "GET /question-generator/available-models (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /question-generator/available-models", False, str(e))

        # Test GET /question-generator/pending-questions
        try:
            response = await client.get(
                f"{API_URL}/question-generator/pending-questions", timeout=10.0
            )
            log_test(
                "GET /question-generator/pending-questions (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /question-generator/pending-questions", False, str(e))

        # Test GET /question-generator/stats
        try:
            response = await client.get(
                f"{API_URL}/question-generator/stats", timeout=10.0
            )
            log_test(
                "GET /question-generator/stats (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /question-generator/stats", False, str(e))


async def test_rag_endpoints():
    """Test 3.2: RAG (Retrieval-Augmented Generation) Endpoints"""
    logger.info("=" * 60)
    logger.info("TEST 3.2: RAG Endpoints")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /rag/library (list RAG documents)
        try:
            response = await client.get(f"{API_URL}/rag/library", timeout=10.0)
            log_test(
                "GET /rag/library (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /rag/library", False, str(e))

        # Test GET /rag/stats (RAG statistics)
        try:
            response = await client.get(f"{API_URL}/rag/stats", timeout=10.0)
            log_test(
                "GET /rag/stats (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /rag/stats", False, str(e))

        # Test GET /rag/providers (available RAG providers)
        try:
            response = await client.get(f"{API_URL}/rag/providers", timeout=10.0)
            log_test(
                "GET /rag/providers (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /rag/providers", False, str(e))

        # Test POST /rag/generate (generate with RAG context)
        try:
            response = await client.post(
                f"{API_URL}/rag/generate",
                json={
                    "subject": "Science",
                    "topic": "Gravity",
                    "question_count": 3,
                    "difficulty": "medium",
                },
                timeout=10.0,
            )
            log_test(
                "POST /rag/generate (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("POST /rag/generate", False, str(e))

        # Test POST /rag/regenerate-question
        try:
            response = await client.post(
                f"{API_URL}/rag/regenerate-question",
                json={"question_id": "test-question-id"},
                timeout=10.0,
            )
            log_test(
                "POST /rag/regenerate-question (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("POST /rag/regenerate-question", False, str(e))


async def test_documents_endpoints():
    """Test 3.3: Document Processing Endpoints (for RAG)"""
    logger.info("=" * 60)
    logger.info("TEST 3.3: Document Processing Endpoints")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /documents/dashboard/list
        try:
            response = await client.get(
                f"{API_URL}/documents/dashboard/list", timeout=10.0
            )
            log_test(
                "GET /documents/dashboard/list (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /documents/dashboard/list", False, str(e))

        # Test GET /documents/dashboard/stats
        try:
            response = await client.get(
                f"{API_URL}/documents/dashboard/stats", timeout=10.0
            )
            log_test(
                "GET /documents/dashboard/stats (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /documents/dashboard/stats", False, str(e))

        # Test POST /documents/batch/status
        try:
            response = await client.post(
                f"{API_URL}/documents/batch/status",
                json={"document_ids": ["doc1", "doc2"]},
                timeout=10.0,
            )
            log_test(
                "POST /documents/batch/status (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("POST /documents/batch/status", False, str(e))


async def test_cost_tracking_endpoints():
    """Test 3.4: Cost Tracking & Quota Management"""
    logger.info("=" * 60)
    logger.info("TEST 3.4: Cost Tracking & Quota Management")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /cost-tracking/quota (get quota)
        try:
            response = await client.get(f"{API_URL}/cost-tracking/quota", timeout=10.0)
            log_test(
                "GET /cost-tracking/quota (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /cost-tracking/quota", False, str(e))

        # Test GET /cost-tracking/check-quota
        try:
            response = await client.get(
                f"{API_URL}/cost-tracking/check-quota", timeout=10.0
            )
            log_test(
                "GET /cost-tracking/check-quota (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /cost-tracking/check-quota", False, str(e))

        # Test GET /cost-tracking/usage-history
        try:
            response = await client.get(
                f"{API_URL}/cost-tracking/usage-history", timeout=10.0
            )
            log_test(
                "GET /cost-tracking/usage-history (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /cost-tracking/usage-history", False, str(e))

        # Test GET /cost-tracking/usage-metrics
        try:
            response = await client.get(
                f"{API_URL}/cost-tracking/usage-metrics", timeout=10.0
            )
            log_test(
                "GET /cost-tracking/usage-metrics (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /cost-tracking/usage-metrics", False, str(e))

        # Test GET /cost-tracking/alerts
        try:
            response = await client.get(f"{API_URL}/cost-tracking/alerts", timeout=10.0)
            log_test(
                "GET /cost-tracking/alerts (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /cost-tracking/alerts", False, str(e))


async def test_admin_ai_endpoints():
    """Test 3.5: Admin AI Configuration Endpoints"""
    logger.info("=" * 60)
    logger.info("TEST 3.5: Admin AI Configuration Endpoints")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        # Test GET /admin/tenant-ai-config/providers
        try:
            response = await client.get(
                f"{API_URL}/admin/tenant-ai-config/providers", timeout=10.0
            )
            log_test(
                "GET /admin/tenant-ai-config/providers (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /admin/tenant-ai-config/providers", False, str(e))

        # Test GET /admin/tenant-ai-config/{tenant_id}
        try:
            response = await client.get(
                f"{API_URL}/admin/tenant-ai-config/test-tenant-id", timeout=10.0
            )
            log_test(
                "GET /admin/tenant-ai-config/{tenant_id} (no auth)",
                response.status_code == 403,
                f"Status: {response.status_code} (expected 403)",
            )
        except Exception as e:
            log_test("GET /admin/tenant-ai-config/{tenant_id}", False, str(e))


async def test_ai_api_structure():
    """Test 3.6: Verify AI API Structure"""
    logger.info("=" * 60)
    logger.info("TEST 3.6: AI API Structure Verification")
    logger.info("=" * 60)

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BASE_URL}/openapi.json", timeout=10.0)
            if response.status_code == 200:
                spec = response.json()
                paths = spec.get("paths", {})

                # Check for AI-related endpoints
                ai_endpoints = [
                    "/api/v1/question-generator/sessions",
                    "/api/v1/question-generator/generate",
                    "/api/v1/question-generator/available-models",
                    "/api/v1/rag/library",
                    "/api/v1/rag/stats",
                    "/api/v1/rag/providers",
                    "/api/v1/cost-tracking/quota",
                    "/api/v1/cost-tracking/usage-history",
                    "/api/v1/cost-tracking/usage-metrics",
                    "/api/v1/documents/dashboard/list",
                ]

                found_count = 0
                for endpoint in ai_endpoints:
                    if endpoint in paths:
                        found_count += 1
                        log_test(f"Endpoint {endpoint}", True, "Found in API spec")
                    else:
                        log_test(f"Endpoint {endpoint}", False, "Not found in spec")

                logger.info(f"Found {found_count}/{len(ai_endpoints)} AI endpoints")
            else:
                log_test(
                    "OpenAPI spec retrieval", False, f"Status: {response.status_code}"
                )
        except Exception as e:
            log_test("AI API structure verification", False, str(e))


async def generate_test_report():
    """Generate final test report"""
    logger.info("\n" + "=" * 80)
    logger.info("PHASE 3: AI FEATURES TEST REPORT")
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
        "phase": "Phase 3: AI Features",
        "total": total_tests,
        "passed": passed_tests,
        "failed": failed_tests,
        "success_rate": (passed_tests / total_tests * 100) if total_tests > 0 else 0,
        "results": test_results,
        "timestamp": datetime.now().isoformat(),
    }


async def main():
    """Main test runner"""
    logger.info("\n" + "=" * 80)
    logger.info("STARTING PHASE 3: AI FEATURES TESTS")
    logger.info("=" * 80)
    logger.info(f"Testing against: {BASE_URL}")
    logger.info(
        "Note: These tests verify AI endpoint protection (all should require auth)"
    )
    logger.info("=" * 80 + "\n")

    # Run all tests
    await test_question_generator_endpoints()
    await test_rag_endpoints()
    await test_documents_endpoints()
    await test_cost_tracking_endpoints()
    await test_admin_ai_endpoints()
    await test_ai_api_structure()

    # Generate report
    report = await generate_test_report()

    # Save report to file
    report_file = "test_reports/phase3_ai_report.json"
    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)
    logger.info(f"\nReport saved to: {report_file}")

    return report


if __name__ == "__main__":
    asyncio.run(main())
