# How the inventory works, in plain words

A short explanation to give the client. It covers three ideas: the
**ledger**, the **month rollover** and the **low-stock alert**. All numbers
are made up.

---

## 1. The ledger: a stock register that is never rubbed out

Think of the old paper stock register. Every time material comes in or goes
out, a new line is written. Nobody tears out a page or overwrites a line.
The system works the same way.

- Each **receipt** or **issue** is one line (an *entry*), with its date, quantity,
  who saved it, and details such as party, challan and bill, or job number.
- An entry can **never be edited or deleted**, not by the store person and not
  by an admin. The database itself refuses it, whatever screen or tool is used.
- A mistake is fixed the way an accountant does it: a **reversal**, a new line
  that cancels the wrong one. Both lines stay, so the history always shows what happened.
- The balance is **never typed**. It is always calculated from the lines:

> **Balance = Opening + Received − Issued**

### Example: product ZZ-005 in November

| Date | Entry | Qty | Balance after |
|---|---|---:|---:|
| 1 Nov | Opening (October's closing) | | 40 |
| 3 Nov | Received from Alpha Dummy Traders, challan CH-11 | +20 | 60 |
| 9 Nov | Issued for job J-7 | −25 | 35 |
| 9 Nov | Issued for job J-8 (typed 52 by mistake) | −52 | *refused: only 35 in stock* |
| 9 Nov | Issued for job J-8 | −5 | 30 |
| 10 Nov | **Reverse** of 9 Nov J-8 (wrong product) | +5 | 35 |

November so far: Opening 40, Received 20, Issued 25 (30 issued, 5 reversed), **Balance 35**.

Built-in safety:
- **You can't issue more than you have.** The database checks the balance at the moment of saving.
- **A double tap saves once.** Every save carries a unique key, so a repeated tap or a retried request is recognised and not saved twice.
- **Numbers are exact.** Quantities keep 3 decimals and money 2 decimals, with no rounding drift. Money is shown the Indian way: ₹1,23,456.00.

## 2. Month rollover: closing the books every month

At the end of every month, the system closes the books by itself.

```mermaid
flowchart LR
  A["November<br/>Opening 40<br/>+ Received 20<br/>− Issued 25"] --> B["Closing 35"]
  B -->|"becomes"| C["December<br/>Opening 35"]
```

- The **first time anyone opens Inventory in a new month**, the system writes down, for every product,
  last month's **opening, received, issued and closing**, and marks the month **closed**.
- The new month's **opening = last month's closing**. Always, automatically.
- A **closed month can't change**: entries can only be dated in the current month (never in the future).
  So November's report printed in January shows exactly what it showed on 1 December.
  *Tip: record every entry before the month ends.*
- If nobody opens the module for a while, say three months, all three months are closed in order
  the next time someone opens it, each one starting from the previous month's closing.
- Admins can pick any closed month and see its figures. Exports for any dates work the same way.

## 3. Low-stock alert: knowing when to reorder

- The store sets a **minimum stock** for each product that matters (for example: keep at least 30 of ZZ-005).
  Products without a minimum never raise an alert.
- A product is **low** when its balance is **below** the minimum:

| Minimum | Balance | Shown as |
|---:|---:|---|
| none | 2 | normal (no minimum, no alert) |
| 30 | 35 | normal |
| 30 | 30 | normal (equal is not low) |
| 30 | 29 | **Low**, shortfall 1 |
| 30 | 0 | **Low, Out of stock**, shortfall 30 |

- At the top of the page a box says **"N items below minimum, order advised"**. It opens the
  **Low Stock** list: balance, minimum, how many are short, and the **last party and date it was
  received from**, so you know whom to call.
- When an issue would take a product below its minimum, the store person gets a **warning before
  confirming**. It is a warning, not a block: production may need the material now.
- The alert **follows the live balance**: once enough stock is received, it disappears by itself.
- Admins see the same alert and list (read-only) and a **Low stock** card on their screen.

## Who can do what

| | Store person (inventory) | Admin / head admin | Marketing, production |
|---|:---:|:---:|:---:|
| See stock, history, alerts, Party search | ✅ | ✅ read-only | — |
| Receive, issue, reverse | ✅ | — | — |
| Products, minimums, settings | ✅ | — | — |
| Exports (PDF, Word, Excel) | ✅ | ✅ | — |
| Trends, top 10 issued, past months | — | ✅ | — |

The rules are checked by the database itself, not only by the screens.

## Backups

The inventory tables can be copied to a file on the office computer at any time, without
changing anything: see [BACKUP.md](BACKUP.md). Supabase's own backups depend on the plan
(the free plan has none): see [DATA-SAFETY.md](../DATA-SAFETY.md#backups).
