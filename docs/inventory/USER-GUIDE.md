# Inventory: quick guide for the store person

One page, everything you need day to day. The examples use made-up
products and parties (serials like **ZZ-005**, "Alpha Dummy Traders").

> **Golden rule:** nothing you save can be deleted or edited. If you made a
> mistake, **Reverse** the entry and record it again. Both stay in the history.

---

## 1. Sign in

1. Open the website, or the **NR Management** app on your phone.
2. Type your **username** and your **6-digit PIN**, then tap **Sign in**.
3. The **Inventory** page opens. You can only see Inventory and Inventory settings.

Too many wrong PINs lock the username for a while. Wait, then try again,
or ask the admin.

## 2. Find a product

- Type in **Search** (serial, material, specification). Capitals and extra spaces don't matter.
- Tap a product to open it: its figures, the **Receive / Issue** form and its recent history.

| Column | Meaning |
|---|---|
| Opening Balance | stock at the start of this month (last month's closing); locked |
| Adjustment | the difference your month-start count made (counted − opening); shown in history and exports when it isn't zero |
| Receiving | everything received this month |
| Issue | everything issued this month |
| **Balance** | Opening + Adjustment + Receiving − Issue: what is in the store now. Shows **Pending** until you enter this month's count |

## 3. Start of the month: enter the balance you counted

On the 1st of every month (from **1 December 2026**) each product starts **Pending**:
its Opening is last month's closing, and the app waits for you to count the shelf.

| You see | Meaning |
|---|---|
| Blue box **"N products need balance"** | how many are still to count, and *"120 of 287 confirmed"* |
| **Pending** chip beside the search | tap it to list only the products still to count |
| **Pending** in the Balance column | not counted yet: it is not in the stock value or the low-stock alert |

**Fast way (many products):**
1. Tap **Enter balances** in the blue box (or the **Pending** chip).
2. Type the counted number in the box of the first product and press **Enter**.
   It saves and jumps to the next product.
3. Same number as the opening? Tap **Same as opening**.
4. Tap **Done** when finished. You can stop and come back; saved rows stay saved.

**One product:** open it and tap **Enter balance**.

- What you type is saved as a **Stock count** line in the history:
  *adjustment = counted − opening* (0 when they are equal), with your name and the time.
- Counted again later (for example after a check)? Open the product, **Count stock**.
  A new adjustment is added; nothing is overwritten.
- If you **Receive** or **Issue** a product that is still Pending, the same form first asks
  *"This month's balance (counted)"*, then saves both together.
- Products you **add during the month** are confirmed when you add them.
- The admins see the Pending count too (read-only).

*Example: ZZ-005, opening 40, you count 38. Adjustment −2, balance 38. Then you issue 5: balance 33.*

## 4. Receive stock (material came in)

1. Open the product and choose **Receive**.
2. Enter the **quantity** and the **date** (today or earlier this month).
3. Optional details: **Party** (pick a suggestion so the name is always spelt the same),
   **Challan No**, **Bill No**, **Bill Date** (not in the future) and a **Remark**.
4. Tap **Review receipt**: check the balance *before → after* and every field.
5. Tap **Confirm receipt**. A message confirms the new balance.

*Example: ZZ-005, 20 Nos. from Alpha Dummy Traders, Challan CH-11, Bill B-204.*

## 5. Issue stock (material went out)

1. Open the product and choose **Issue**.
2. Enter the **quantity** and the **date**.
3. Optional details: **Job No**, **Rating**, **No. of Jobs** and a **Remark**.
4. Tap **Review issue**, check, then **Confirm issue**.

- You **cannot issue more than the balance**; the app refuses it.
- If the issue takes the product **below its minimum**, you get a warning. You may still confirm.

**Made a mistake?** In *Recent history*, tap **Reverse** on that entry. It
adds a new entry that cancels it (with the same details), and the balance goes back.
Then record it again correctly.

## 6. Minimum stock and the low-stock alert

- **Set a minimum:** in **Edit details** of a product, or in **Inventory settings → Minimum stock**
  (type a number; it saves when you leave the field). To give many products the same minimum,
  search them, then **Set for all filtered** and confirm. Leave it empty for no minimum.
- **Low** means the balance is **below** the minimum. Equal to the minimum is fine.
  A balance of **0** shows **Out of stock**.
- The yellow box at the top says **"N items below minimum, order advised"**. Tap it for the
  **Low Stock** list: balance, minimum, shortfall, last party and last received date.
- Tap the **Low** chip beside the search to show only low products.
- The alert goes away by itself once enough stock is received.
- A product still **Pending** this month is never in the alert: its balance isn't counted yet.

## 7. Party search

- Type a party in the **Party** field beside the search (pick a suggestion).
- You see only the products received from that party, from **all months**, with the quantity
  received and the last challan, bill and date.
- It works together with the search and the **Low** chip. The **×** clears it.
- Entries saved before the Party field existed have no party, so they don't show up here.

## 8. Export (PDF, Word, Excel)

1. Tap **Export**.
2. Choose a period: **This week**, **This month**, **Previous month**, **All** or **Custom** dates.
3. Tap **PDF**, **Word** or **Excel**. The file downloads; in the app it opens or can be shared (WhatsApp, Drive, print).

Each file shows Opening, Received, Issued and Closing for the period, with totals.
The totals always match the screen.

- When any month-start count changed a balance, an **Adjustment** column appears:
  Opening + Adjustment + Received − Issued = Closing on every line.
- In this month's file, a product not counted yet shows **Pending** instead of a closing
  balance, and is left out of the closing value. The file says *"Confirmed: N of M"*.

## 9. Archive

- **Archive** a product that is no longer used from its panel (**Archive product**). It leaves the list,
  the totals and the alerts. Nothing is deleted: its history stays.
- The **Archive** tab (in the menu) lists every archived product with its archived date and last balance.
  Search works the same way.
- **Restore:** tap **Restore** on one, or tick several and tap **Restore N**, then confirm.
  It comes back with its history; nothing in the ledger changes. From December 2026 a product that
  existed before this month comes back **Pending** until you enter its balance.
- **Delete:** only for a product **added by mistake** that never had any entry, count or closed month.
  Type its serial to confirm. It can't be undone (a copy is kept in the database).
  A product with history shows *"Has history, can only be restored"*.

## 10. Good habits

- On the 1st, count and enter every balance **before** the first receipt or issue of the month.
- Record receipts **the same day**, with the **Party** and **Challan No**.
- Don't type a new spelling of a party: pick the suggestion.
- Products that are no longer used: **Archive product** (it can be restored; its history stays).
- No internet? The app shows *You're offline* with **Retry**. Nothing is half-saved.
