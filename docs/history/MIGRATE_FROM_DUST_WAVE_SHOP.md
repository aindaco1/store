# Migrating From DUST WAVE Snipcart Shop

The old shop used Jekyll product files, Snipcart `data-item-*` attributes, Pages CMS, and GitHub Actions for archiving products.

Store keeps the repo-backed product source but moves away from Snipcart:

- `_products/*.md` remain the editable source catalog.
- `identifier` becomes the Store product ID.
- `sku`, `fulfillment_type`, `status`, `shipping_preset`, `tax_category`, `inventory_tracking`, and `inventory` are added.
- Shirts now have explicit size variants with `sku`, `price`, and `inventory`.
- Product buttons use `store-add-item` rather than `snipcart-add-item`.
- Pages CMS is replaced by the Store admin dashboard path.
- Archive/unarchive should become an admin product status change and GitHub-backed publish operation.

The old catalog did not contain real inventory counts. Every imported inventory count is currently `0`; fill those counts before a production checkout launch.

This file is retained as migration history. Current launch and operator docs live one level up in `docs/`.
