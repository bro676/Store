# Nexa product asset hierarchy

Static artwork follows the same order as the storefront:

`department / supplier-category / storefront-product / options / packs`

Example:
```text
assets/products/
  01-games/
    cover.svg
    pubg/
      cover.svg
      options/README.md
  05-digital-cards/
    cover.svg
    steam/
      cover.svg
      options/README.md
  08-ai/
    cover.svg
    chatgpt/
      cover.svg
      options/README.md
```

The canonical dynamic path is calculated by `NexaCatalog.folderFor(category, product, option, pack)`. It includes the department number, category name + ID, internal/storefront product name + ID, option name + ID, and pack label.

**Naming convention:** keep the storefront-facing product name as the folder slug. Preserve the supplier's external product ID in the suffix/source metadata so renaming the display name never breaks its API link. Never include API secrets or customer account data in filenames.

The imported WAMDA catalog remains dynamic in PostgreSQL. These folders hold static artwork and sensible product-specific image locations; the repository deliberately does not contain thousands of empty directories copied from the live database.
