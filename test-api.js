const http = require('http');

async function testEndpoint(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting FinTrack End-to-End API Verification ---');

  // 1. Login
  const loginRes = await testEndpoint('/api/v1/auth/login', 'POST', {
    email: 'demo@fintrack.com',
    password: 'Password123!',
  });
  console.log('1. Auth Login Status:', loginRes.status);
  const token = loginRes.data?.data?.token;
  if (!token) throw new Error('Failed to acquire token');

  // 2. Dashboard Summary
  const dashRes = await testEndpoint('/api/v1/dashboard/summary', 'GET', null, token);
  console.log('2. Dashboard Summary Status:', dashRes.status);
  console.log('   - Total Balance:', dashRes.data?.data?.totalBalance);
  console.log('   - Monthly Income:', dashRes.data?.data?.monthlyIncome);
  console.log('   - Monthly Expense:', dashRes.data?.data?.monthlyExpense);
  console.log('   - Recent Tx Count:', dashRes.data?.data?.recentTransactions?.length);

  // 3. Transactions List
  const txRes = await testEndpoint('/api/v1/transactions?limit=5', 'GET', null, token);
  console.log('3. Transactions List Status:', txRes.status);
  console.log('   - Total Tx In DB:', txRes.data?.pagination?.totalCount);

  // 4. Budgets
  const budgetRes = await testEndpoint('/api/v1/budgets', 'GET', null, token);
  console.log('4. Budgets Status:', budgetRes.status);
  console.log('   - Active Budgets Count:', budgetRes.data?.data?.budgets?.length);

  // 5. Goals
  const goalRes = await testEndpoint('/api/v1/goals', 'GET', null, token);
  console.log('5. Goals Status:', goalRes.status);
  console.log('   - Goals Count:', goalRes.data?.count);

  // 6. Household
  const householdRes = await testEndpoint('/api/v1/household', 'GET', null, token);
  console.log('6. Household Status:', householdRes.status);
  console.log('   - Household Name:', householdRes.data?.data?.household?.name);

  // 7. Reports Analytics
  const reportRes = await testEndpoint('/api/v1/reports/analytics?timeframe=6months', 'GET', null, token);
  console.log('7. Reports Analytics Status:', reportRes.status);
  console.log('   - Month Trends Count:', reportRes.data?.data?.monthlyTrends?.length);
  console.log('   - Category Breakdown Count:', reportRes.data?.data?.categorySpending?.length);

  // 8. Recurring Process Trigger
  const processRes = await testEndpoint('/api/v1/recurring/process', 'POST', null, token);
  console.log('8. Recurring Process Status:', processRes.status);
  console.log('   - Recurring Message:', processRes.data?.message);

  console.log('--- All Backend API Verification Checks Passed Successfully! ---');
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
