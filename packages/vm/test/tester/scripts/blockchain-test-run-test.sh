#!/bin/sh -x
##################################################################
# Manual test file for blockchain test runner option sanity checks
#
# Evoke from repository root with
# ./test/tester/scripts/blockchain-test-run-test.sh
##################################################################

FILE=randomStatetest303 npx vitest run ./test/tester/blockchain/index.spec.ts
# Test that uses the expectException properties in BlockchainTests test files
FILE=GasUsedHigherThanBlockGasLimitButNotWithRefundsSuicideLast npx vitest run ./test/tester/blockchain/index.spec.ts
