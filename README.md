# ExpensaReview

Your spending, savings and net worth across SG, the Livret A, Revolut and Lebanon, with MoM, QoQ, YoY and YTD views and a full contribution-to-change breakdown.

## Where your data lives

| Place | What it holds |
|---|---|
| GitHub (this app) | Only the app: no figures, no account numbers, no keys. Safe to be public. |
| Your Google Sheet | Every bank line, balance, setting, decision and category rule. |
| Your Apps Script properties | Your password, the Enable Banking key, the Claude key. Never in the Sheet, never in the app. |
| Your phone | A cached copy so the app opens fast. Removed if you clear Safari data. |

## Files

Upload to GitHub: `index.html`, `app.js`, `engine.js`, `sw.js`, `manifest.json`, `icon.svg`, `icon-180.png`, `icon-192.png`, `icon-512.png`, and the folder `vendor/` with its two files (the PDF reader).

Do **not** upload `Code.gs` (it goes into Google Apps Script) or this README.

## Install, once

Steps 1 and 5 are easiest on a computer. On iPhone, use Safari with "Request Desktop Website".

### 1. The Google Sheet (about 5 minutes)
1. Open sheets.google.com and create a blank Sheet. Name it **ExpensaReview**.
2. Extensions, then Apps Script. Delete everything in the editor and paste all of `Code.gs`. Press the save icon.
3. In the toolbar, choose the function **setup** and press **Run**. Accept the permissions (Advanced, then Go to project, then Allow).
4. The log at the bottom shows **Your ExpensaReview password**. Copy it somewhere safe.
5. Deploy, New deployment, the gear icon, **Web app**. Execute as **Me**, Who has access **Anyone**. Deploy and copy the Web app URL.

"Anyone" means the link answers anyone, but it returns nothing without your password.

### 2. The app on GitHub (about 5 minutes)
1. On github.com, create a new repository named **expensareview** (public is fine: it holds no data).
2. Add file, Upload files: everything listed above, including the `vendor` folder. Commit.
3. Settings, Pages, Source: Deploy from a branch, branch **main**, folder **/ (root)**. Save.
4. After a minute the app is at `https://YOUR-NAME.github.io/expensareview/`. On iPhone: open it in Safari, Share, **Add to Home Screen**.

### 3. In the app: Setup
1. **Connect your Google Sheet**: paste the Web app URL and the password.
2. **Your accounts**: your name as it appears on transfers between your own accounts, your employer as it appears on the salary line, and the last four digits of the current account and of the Livret A (the end of each IBAN).
3. **Bring in your history**: choose all the SG PDF statements at once (current account and Livret A, 2024 and 2025), then the SG CSV for 2026, then the Revolut CSV. Check the summary, then **Save to my Sheet**. Each PDF is checked against its own opening and closing balance.
4. **Opening balances**: worked out from the statements. For an account with no statement, type what the bank shows today.

### 4. Lebanon and Amazon: Net worth
1. **Lebanon, your share**: your cash and gold only, as of a date. TapTap sends after that date are added from SG by themselves.
2. **Your Amazon grant**: type the number of shares, press **Use the 5/15/20/20/20/20 schedule** and give the date of your first vest; check every date against your Amazon stock account. Press **Fill vest-day prices**, then correct any price that differs from your payslip. Set your income tax bracket (TMI).

### 5. Link your banks (optional, about 10 minutes)
1. Create an account at enablebanking.com, then Control Panel, API applications, add an application: **Production**, redirect URL exactly as shown in the app's Setup step 5, key generated in the browser. A `.pem` file downloads.
2. Press **Activate by linking accounts** and approve Société Générale, then Revolut. On the free plan, only accounts linked this way can be read.
3. In the app: paste the application ID, choose the `.pem` file, **Save**. Then **Link Société Générale**, approve at SG, and you come back to the app. The same for Revolut.
4. Press **Sync now**. From then on your script syncs every morning at 6. Every 180 days each bank asks you to approve again; the app shows the date.

If the app says the key is in "RSA PRIVATE KEY" format, convert it once on a computer with:
`openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem` and use the new file.

### 6. Smart categories (optional)
Create an API key at console.anthropic.com (billed separately from a Claude subscription, a few cents a month at this volume), paste it in Setup step 6, and press **Sort unknown merchants**. Only merchant names are sent. Your answers in Transactions always win over Claude's.

## How the numbers are built

- **Real spending** is money that leaves all your accounts. Transfers between SG, the Livret A, Revolut and the Lebanon wallet are paired and never counted as spending or income.
- **SG to Revolut**: the SG line is paired with the matching Revolut top-up (same amount, within 4 days). Only Revolut card payments count. Until Revolut is imported or linked, top-ups show as "Spent via Revolut" so spending is not understated.
- **Livret A**: money in and out is a transfer; the interest is income.
- **Duplicates**: a line found in a PDF, the CSV and the bank feed is kept once, by account, date and amount.
- **Refunds** marked "REMBT dd/mm" are booked back to the month of the purchase.
- **Balance check**: every statement balance is compared with what the app adds up for that day. A gap means a missing or doubled line, and it shows in Accounts.

## Amazon shares and French tax (an estimate, not tax advice)

- Plans from US companies, Amazon's included, are usually not French-qualified: each vest is taxed as salary when it vests, through your payslip. If your payslip shows social charges on the RSU value in the vesting month, your plan is not qualified.
- Vested shares you still hold: only a rise since the vesting day is taxed when you sell, at the flat tax (31.4% in 2026).
- Shares still to vest: about 22% social charges plus income tax at your bracket.
- If your plan is French-qualified, switch the plan type: income tax on half the vesting value and 18.6% social levies, both at sale.

## What was tested, and what was not

Tested here, with your real files: the SG CSV (609 lines) and the October 2026 PDF statement (93 lines, debits and credits equal to the statement totals, balances to the cent, all 93 lines recognised as already in the CSV); pairing, the balance check, every screen on desktop and phone width, and the Net worth tax arithmetic. The app was driven against a stand-in for the Google script.

Not tested yet: the real Google script, the Enable Banking link (no access from here), a Revolut export (none provided yet; the reader follows Revolut's standard CSV columns), Livret A PDF statements, and the price services from Google's servers. The first run of each is yours; send me any error message the app shows.
