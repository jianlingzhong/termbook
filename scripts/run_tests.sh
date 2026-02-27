#!/bin/bash

# Ensure a clean state before starting
python3 manage_debug_servers.py stop

# Run backend tests
echo "Running backend tests..."
cd backend
npm test
BACKEND_TEST_EXIT_CODE=$?
cd ..

# Start servers using the management script with log clearing
echo "Starting servers..."
python3 manage_debug_servers.py start --clear-logs

# Run frontend E2E tests
echo "Running frontend tests..."
cd frontend
npx playwright test
FRONTEND_TEST_EXIT_CODE=$?
cd ..

# Stop servers
python3 manage_debug_servers.py stop

# Exit with error if any test failed
if [ $BACKEND_TEST_EXIT_CODE -ne 0 ] || [ $FRONTEND_TEST_EXIT_CODE -ne 0 ]; then
  exit 1
fi

exit 0
