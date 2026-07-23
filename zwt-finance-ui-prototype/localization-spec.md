# ZWT Finance Localization Specification

## Confirmed policy

- The default interface language is Simplified Chinese (`zh-CN`).
- Users can switch the interface to English (`en-US`) without changing business data.
- PostgreSQL columns, constraints, indexes, enum codes and audit identifiers use stable
  English names.
- FastAPI request and response properties use English names.
- React domain models use English keys. Only the presentation layer resolves translated
  labels.
- Translated labels must never be stored in business tables.

## Example data flow

```text
PostgreSQL status = "approved"
        ↓
FastAPI JSON status = "approved"
        ↓
React task.status = "approved"
        ↓
zh-CN resource status.approved = "已批准"
en-US resource status.approved = "Approved"
```

Changing the language therefore causes no update request and creates no audit event.

## WHT field mapping

| Database / API identifier | Chinese UI label | English UI label |
| --- | --- | --- |
| `task_no` | 任务编号 | Task No. |
| `book_no` | 册码 | Book No. |
| `period` | 期数 | Period |
| `company_name` | 公司名称 | Company Name |
| `tax_id` | 税号 | Tax ID |
| `wht_type` | WHT 类型 | WHT Type |
| `income_type` | 收入类型 | Income Type |
| `wht_rate` | 预扣税率 | WHT Rate |
| `document_count` | 文件数量 | Document Count |
| `total_amount` | 总金额 | Total Amount |
| `wht_amount` | 预扣税额 | WHT Amount |
| `due_date` | 到期日 | Due Date |
| `created_by` | 创建人 | Created By |
| `created_at` | 创建时间 | Created At |
| `updated_by` | 更新人 | Updated By |
| `updated_at` | 更新时间 | Updated At |

## Enum and workflow mapping

| Stored code | Chinese UI label | English UI label |
| --- | --- | --- |
| `draft` | 草稿 | Draft |
| `pending` | 待复核 | Pending Review |
| `approved` | 已批准 | Approved |
| `issued` | 已出具 | Issued |
| `normal` | 正常开具 | Normal period |
| `supplement` | 补开（BK） | Supplement (BK) |

Enum codes are not PostgreSQL display labels. New languages or wording changes must not
require a data migration.

## API errors and audit logs

- FastAPI returns an English error code and structured parameters, for example
  `{ "code": "wht_number_duplicate", "params": { "task_no": "ZWT202606001" } }`.
- The frontend converts the code to the active language.
- Audit records store field identifiers such as `due_date`, plus old and new values.
- Audit screens translate `due_date` to `到期日` or `Due Date` when rendered.
- Server logs retain stable English identifiers for searching and support.

## Export behavior

- Database backups and integration exports retain English field identifiers.
- User-facing Excel/PDF column headings follow the selected report template language.
- Official WHT and TAX INV document wording follows the approved document template and is
  independent from the operator interface language.

## Frontend implementation

The prototype uses `src/i18n.js` as a small language-resource boundary. The formal
TypeScript implementation should preserve the same keys behind a typed i18n adapter, split
resources by module, and lazy-load module dictionaries together with module routes.
