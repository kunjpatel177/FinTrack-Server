# FinTrack Backend API Engine (`server/`)

Production-grade Node.js and Express RESTful API server powering the **FinTrack** personal finance and wealth management platform. Built with MongoDB, Mongoose, and enterprise-grade security protocols, this backend delivers robust transaction accounting, multi-tier MFA, dynamic budget variance tracking, and automated recurring billing.

---

## 🛠️ Technology Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v18+) | Non-blocking, event-driven JavaScript runtime |
| **Framework** | Express.js 4.19 | Fast, minimalist web framework for RESTful APIs |
| **Database** | MongoDB & Mongoose 8.5 | Schematized document store with aggregation pipelines |
| **Authentication** | JWT (`jsonwebtoken`) & `bcryptjs` | Stateless token authorization with 12-round salted password hashing |
| **MFA / 2FA** | `speakeasy` & `qrcode` | RFC 6238 Time-based One-Time Password (TOTP) generator & verifier |
| **Email Delivery** | `nodemailer` | SMTP client for email OTP, account verification, and password resets |
| **Security** | `helmet`, `cors`, `express-rate-limit` | HTTP headers hardening, origin filtering, and brute-force throttling |
| **Data Export** | `json2csv` | Streaming CSV generation for transaction records |
| **Logging** | `morgan` | HTTP request logging for development and auditing |

---

## 📁 Directory Structure

```
server/
├── config/                 # MongoDB database connection and system constants
│   ├── db.js               # Mongoose connection handler with graceful reconnection
│   └── constants.js        # Default categories, currencies, payment methods, intervals
├── controllers/            # Request controllers encapsulating business logic
│   ├── activityController.js   # Audit log timeline and purge operations
│   ├── authController.js       # Register, login, 4-tier MFA, session, profile, password
│   ├── budgetController.js     # Category & overall budget limits with spend variance
│   ├── categoryController.js   # Default and custom categories with safe deletion
│   ├── dashboardController.js  # Executive metrics, net balance, 6-month trend lines
│   ├── goalController.js       # Milestone targets, contributions, and withdrawals
│   ├── householdController.js  # Multi-tenant invite tokens, role RBAC, shared ledger
│   ├── recurringController.js  # Automated schedules and manual trigger execution
│   ├── reportController.js     # Multi-period analytics, top categories, payment mix
│   └── transactionController.js# CRUD, filtering, pagination, CSV export, budget warnings
├── middleware/             # Express request pipeline middlewares
│   ├── auth.js             # Bearer JWT verification and user context hydration
│   ├── error.js            # Centralized error handler (CastError, DuplicateKey, Validation)
│   └── rateLimiter.js      # Endpoint throttling on auth and password reset routes
├── models/                 # Mongoose schema definitions with indexes
│   ├── Activity.js         # Audit log records with action tags and metadata
│   ├── Budget.js           # Category and overall monthly budget limits
│   ├── Category.js         # System and custom expense/income tags with icons
│   ├── Goal.js             # Milestone savings targets with deposits/withdrawals history
│   ├── Household.js        # Collaborative group ledger with invite tokens and roles
│   ├── Recurring.js        # Bill and income schedules with next-due calculators
│   ├── Transaction.js      # Income, expense, and adjustment entries
│   └── User.js             # User accounts, hashed passwords, MFA secrets, preferences
├── routes/                 # Express REST route definitions mounted at /api/v1
│   ├── activityRoutes.js
│   ├── authRoutes.js
│   ├── budgetRoutes.js
│   ├── categoryRoutes.js
│   ├── dashboardRoutes.js
│   ├── goalRoutes.js
│   ├── householdRoutes.js
│   ├── recurringRoutes.js
│   ├── reportRoutes.js
│   └── transactionRoutes.js
├── seed/                   # Database seeder with 4 months of realistic demo finances
│   └── seed.js
├── services/               # Background engines and auxiliary utilities
│   ├── activityLogger.js   # Asynchronous audit event recorder
│   ├── emailService.js     # Nodemailer SMTP transporter for OTP and verification
│   └── recurringEngine.js  # Idempotent recurring bill processor running on intervals
├── app.js                  # Express middleware configuration and router mounting
├── server.js               # Application entry point, HTTP listener, and engine runners
├── test-api.js             # Automated end-to-end API test suite
├── test-auth-mfa.js        # Multi-factor authentication test suite
├── test-smtp.js            # SMTP connectivity test utility
├── .env.example            # Environment template
└── package.json            # Server dependencies and lifecycle scripts
```

---

## ⚙️ Environment Variables

Create a `.env` file in the `server/` directory based on `.env.example`:

```env
# Server Runtime
NODE_ENV=development
PORT=5000

# Database
MONGO_URI=mongodb://localhost:27017/fintrack

# JWT Authorization
JWT_SECRET=fintrack_super_secret_jwt_key_2026_production_grade
JWT_EXPIRE=7d

# CORS Allowed Origin
CLIENT_URL=http://localhost:5173

# SMTP Email Configuration (Optional for real email OTP delivery)
SMTP_SERVICE=gmail
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_16_char_app_password
# Or custom SMTP:
# SMTP_HOST=smtp.mailgun.org
# SMTP_PORT=587
# SMTP_SECURE=false
```

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Configure MongoDB
Ensure MongoDB is running locally on port `27017` or provide a valid MongoDB Atlas connection URI in `server/.env`.

### 3. Seed Demo Data (Recommended)
Pre-populate the database with 4 months of realistic financial transactions, categories, budgets, recurring bills, and savings goals:
```bash
npm run seed
```

**Preloaded Demo Accounts:**
- **Primary User**: `demo@fintrack.com` | Password: `Password123!` (Household Owner)
- **Household Partner**: `priya@fintrack.com` | Password: `Password123!` (Household Admin)

### 4. Start the Server
- **Production Mode**:
  ```bash
  npm start
  ```
- **Development Mode (Auto-restart on save)**:
  ```bash
  npm run dev
  ```

The server will boot on `http://localhost:5000`. Upon startup, it will:
1. Verify database connection to MongoDB.
2. Initialize background recurring transaction processor.
3. Serve the API at `/api/v1`.

---

## 📡 Complete REST API Reference

All protected endpoints require the following HTTP header:
```http
Authorization: Bearer <jwt_token>
```

### 1. Health Check
- `GET /api/v1/health` — Returns server uptime and operational status (`public`).

### 2. Authentication & Profile (`/api/v1/auth`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | Public | Register new user account |
| `POST` | `/login` | Public | Authenticate user; returns JWT or prompts MFA challenge |
| `POST` | `/mfa/verify` | Public | Verify TOTP code or Email OTP during login challenge |
| `POST` | `/mfa/setup-totp` | Protected | Generate TOTP secret and QR code for authenticator apps |
| `POST` | `/mfa/enable-totp` | Protected | Finalize and activate TOTP after verifying first code |
| `POST` | `/mfa/disable` | Protected | Disable multi-factor authentication |
| `GET` | `/me` | Protected | Fetch current user profile and preferences |
| `PUT` | `/profile` | Protected | Update display name, email, currency preference |
| `PUT` | `/password` | Protected | Change existing account password |
| `POST` | `/forgot-password` | Public | Request password reset token via email |
| `POST` | `/reset-password/:token` | Public | Reset password using one-time token |

### 3. Dashboard (`/api/v1/dashboard`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/summary` | Protected | Total net balance, monthly inflow/outflow, savings rate, budget burn |
| `GET` | `/charts` | Protected | 6-month income vs expense bar chart, category donut breakdown |

### 4. Transactions (`/api/v1/transactions`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | Paginated transactions with type, category, date, search filters |
| `POST` | `/` | Protected | Create transaction; checks category budget and returns warnings |
| `GET` | `/:id` | Protected | Fetch single transaction details |
| `PUT` | `/:id` | Protected | Update transaction and recalculate budget impact |
| `DELETE` | `/:id` | Protected | Delete transaction and restore balances |
| `GET` | `/export/csv` | Protected | Stream filtered transactions as a downloadable CSV file |

### 5. Budgets (`/api/v1/budgets`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | Active budgets with spent calculations and warning thresholds |
| `POST` | `/` | Protected | Create monthly budget for a category or overall wallet |
| `PUT` | `/:id` | Protected | Update budget spending ceiling |
| `DELETE` | `/:id` | Protected | Remove budget target |
| `GET` | `/history` | Protected | 6-month budget vs actual spending variance comparison |

### 6. Recurring Transactions & Bills (`/api/v1/recurring`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | List recurring bill and income schedules |
| `POST` | `/` | Protected | Create recurring schedule (daily, weekly, monthly, yearly) |
| `PUT` | `/:id` | Protected | Update schedule amount, interval, or next due date |
| `DELETE` | `/:id` | Protected | Remove recurring schedule |
| `POST` | `/process` | Protected | Manually execute due recurring items immediately |

### 7. Savings Goals (`/api/v1/goals`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | List savings goals with progress percentages |
| `POST` | `/` | Protected | Create financial savings milestone |
| `PUT` | `/:id` | Protected | Modify target amount or target date |
| `DELETE` | `/:id` | Protected | Delete goal |
| `POST` | `/:id/contribute` | Protected | Deposit funds into a goal with transaction recording |
| `POST` | `/:id/withdraw` | Protected | Withdraw saved funds back into available balance |

### 8. Household Collaboration (`/api/v1/household`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | View active household members and roles |
| `POST` | `/` | Protected | Create a new shared household |
| `POST` | `/invite` | Protected | Generate 48-character invite token (Owner/Admin) |
| `POST` | `/accept-invite` | Protected | Join household using invite token |
| `DELETE` | `/members/:userId` | Protected | Remove member from household |
| `POST` | `/leave` | Protected | Leave active household |
| `GET` | `/transactions` | Protected | Stream shared household transactions |

### 9. Categories (`/api/v1/categories`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | List system default and custom user categories |
| `POST` | `/` | Protected | Create custom category with color and icon |
| `PUT` | `/:id` | Protected | Update category metadata |
| `DELETE` | `/:id` | Protected | Safely delete custom category (checks active dependencies) |

### 10. Reports & Analytics (`/api/v1/reports`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/analytics` | Protected | Aggregations by date range, top categories, payment breakdown |

### 11. Activity Logs (`/api/v1/activities`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Protected | Paginated chronological audit log of user actions |
| `DELETE` | `/` | Protected | Clear activity history |

---

## 🔒 Security Architecture

1. **Password Hashing**: Bcrypt with salt work factor of 12. Plaintext passwords never enter logs or database.
2. **Two-Factor Authentication (MFA)**:
   - Authenticator App (RFC 6238 TOTP with QR Code).
   - Email OTP fallback via Nodemailer.
3. **Double-Entry Balance Accounting**:
   - Starting balance adjustments, transaction additions, and goal transfers are mathematically balanced to prevent drift.
4. **Rate Limiting**:
   - Throttles brute-force password and MFA attempts to 10 requests per 15 minutes per IP.
5. **CORS & Headers**:
   - Strict origin binding to frontend `CLIENT_URL` with credentials support.
   - Helmet HTTP headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`).

---

## 🧪 Automated Testing

Verify API endpoints and authentication flows:
```bash
# E2E API Test Suite (Run while server is running)
node test-api.js

# Multi-factor authentication test suite
node test-auth-mfa.js

# SMTP email transport test
node test-smtp.js
```
