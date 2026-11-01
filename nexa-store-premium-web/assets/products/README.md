# Nexa product asset hierarchy

The filesystem mirrors the customer journey, from the main department to the final pack:

```text
assets/products/
  01-games/
    cover.svg
    supplier-category-name--supplier-category-id/
      storefront-product-name[--source-supplier-product-name]--product-id/
        cover.svg
        options/
          option-or-region-name--option-id/
            cover.svg
            packs/
              pack-name/
                cover.svg
  05-digital-cards/
    cover.svg
    steam/
      cover.svg
      options/
        README.md
  08-ai/
    cover.svg
    chatgpt/
      cover.svg
      options/
        README.md
```

## Canonical naming rule

Use this path pattern:

`assets/products/{department}/{category-slug}--{category-id}/{internal-product-slug}[--source-{external-product-slug}]--{product-id}/options/{option-slug}--{option-id}/packs/{pack-slug}`

- **Main department:** fixed numbered folder, such as `01-games` or `08-ai`.
- **Supplier category:** category name and stable category ID.
- **Product:** the name customers see in Nexa first. When the WAMDA/SEAGM name differs, append `--source-{external-name}`. Always keep the external product ID at the end so renaming the display name does not break source matching.
- **Option / region:** its displayed name and stable option ID.
- **Pack:** the exact customer-facing pack label.

The canonical helper is `NexaCatalog.folderFor(category, product, option, pack)`. It returns this path using internal and external source names where available.

## Important

The supplier catalogue remains dynamic in PostgreSQL and continues to use its original category and product IDs. This directory stores covers and product-specific artwork paths, not thousands of empty directories copied from live supplier data. Existing flat artwork paths are retained as compatibility copies until all older stored references can be retired safely. Never put API tokens, customer account data or other secrets in filenames.
