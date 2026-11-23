import { z } from "zod";

// ─── Shopify Storefront API client ──────────────────────────────────────────
// Catalog reads (collections, products, variants, tags, images) go through the
// Storefront GraphQL API using a token from the store's Headless channel. This
// needs no custom/Dev Dashboard app, works for smart and manual collections,
// and keeps the collection's own sort order.
//
// Env:
//   SHOPIFY_STORE_DOMAIN               e.g. my-store.myshopify.com
//   SHOPIFY_STOREFRONT_PRIVATE_TOKEN   Headless channel private token (preferred, server-side)
//   SHOPIFY_STOREFRONT_PUBLIC_TOKEN    Headless channel public token (fallback)
//   SHOPIFY_STOREFRONT_API_VERSION     optional, defaults below

const API_VERSION = process.env.SHOPIFY_STOREFRONT_API_VERSION || "2025-10";

async function storefrontQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const privateToken = process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN;
  const publicToken = process.env.SHOPIFY_STOREFRONT_PUBLIC_TOKEN;
  if (!domain || (!privateToken && !publicToken)) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_PRIVATE_TOKEN (or SHOPIFY_STOREFRONT_PUBLIC_TOKEN) must be set"
    );
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (privateToken) headers["Shopify-Storefront-Private-Token"] = privateToken;
  else headers["X-Shopify-Storefront-Access-Token"] = publicToken!;

  const res = await fetch(`https://${domain}/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify Storefront ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Shopify Storefront GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data as T;
}

const gidToNumber = (gid: string) => Number(gid.split("/").pop());
const toCollectionGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/Collection/${id}`);
const toVariantGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`);

// ─── Product shape (kept compatible with the old Admin REST shape) ──────────

const ShopifyVariantSchema = z.object({
  id: z.number(),
  title: z.string(),
  sku: z.string().nullable().optional(),
  price: z.string().optional(),
  compare_at_price: z.string().nullable().optional(),
  available: z.boolean().optional(),
  // e.g. { Plan: "Lower Carb", Portion: "Regular" }
  options: z.record(z.string()).optional(),
});

const ShopifyProductSchema = z.object({
  id: z.number(),
  handle: z.string().optional(),
  title: z.string(),
  body_html: z.string().nullable().optional(),
  product_type: z.string().optional(),
  variants: z.array(ShopifyVariantSchema),
  image: z.object({ src: z.string() }).nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export type ShopifyProduct = z.infer<typeof ShopifyProductSchema>;
export type ShopifyVariant = z.infer<typeof ShopifyVariantSchema>;

const PRODUCT_FIELDS = /* GraphQL */ `
  fragment PortalProduct on Product {
    id
    handle
    title
    descriptionHtml
    productType
    tags
    featuredImage { url }
    variants(first: 50) {
      nodes {
        id
        title
        sku
        availableForSale
        price { amount }
        compareAtPrice { amount }
        selectedOptions { name value }
      }
    }
  }
`;

type GqlProduct = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  productType: string;
  tags: string[];
  featuredImage: { url: string } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      availableForSale: boolean;
      price: { amount: string };
      compareAtPrice: { amount: string } | null;
      selectedOptions: Array<{ name: string; value: string }>;
    }>;
  };
};

function mapProduct(p: GqlProduct): ShopifyProduct {
  return ShopifyProductSchema.parse({
    id: gidToNumber(p.id),
    handle: p.handle,
    title: p.title,
    body_html: p.descriptionHtml,
    product_type: p.productType,
    tags: p.tags,
    image: p.featuredImage ? { src: p.featuredImage.url } : null,
    variants: p.variants.nodes.map((v) => ({
      id: gidToNumber(v.id),
      title: v.title,
      sku: v.sku,
      price: v.price.amount,
      compare_at_price: v.compareAtPrice?.amount ?? null,
      available: v.availableForSale,
      options: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])),
    })),
  });
}

// ─── Collections ────────────────────────────────────────────────────────────

const COLLECTION_PRODUCTS_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query CollectionProducts($id: ID!, $after: String) {
    collection(id: $id) {
      id
      products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) {
        pageInfo { hasNextPage endCursor }
        nodes { ...PortalProduct }
      }
    }
  }
`;

// Products in a collection (smart or manual), in the collection's own sort
// order. An unknown/deleted collection returns an empty list.
export async function getCollectionProducts(collectionId: string): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  let after: string | null = null;
  do {
    const data: {
      collection: {
        products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlProduct[] };
      } | null;
    } = await storefrontQuery(COLLECTION_PRODUCTS_QUERY, { id: toCollectionGid(collectionId), after });
    if (!data.collection) return out;
    out.push(...data.collection.products.nodes.map(mapProduct));
    after = data.collection.products.pageInfo.hasNextPage ? data.collection.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

// The Storefront API already returns products in collection order.
export const getCollectionProductsSorted = getCollectionProducts;

const ShopifyCollectionSchema = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
});

export type ShopifyCollection = z.infer<typeof ShopifyCollectionSchema>;

// All collections published to the Headless storefront (smart and manual).
export async function listBundleCollections(): Promise<ShopifyCollection[]> {
  const out: ShopifyCollection[] = [];
  let after: string | null = null;
  do {
    const data: {
      collections: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; title: string; handle: string }>;
      };
    } = await storefrontQuery(
      `query Collections($after: String) {
        collections(first: 250, after: $after, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes { id title handle }
        }
      }`,
      { after }
    );
    out.push(
      ...data.collections.nodes.map((c) =>
        ShopifyCollectionSchema.parse({ id: gidToNumber(c.id), title: c.title, handle: c.handle })
      )
    );
    after = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
  } while (after);
  return out;
}

// ─── Variants → products ────────────────────────────────────────────────────

// Products keyed by the variant ids asked for. Variants that no longer exist
// are left out.
export async function getProductsByVariantIds(variantIds: string[]): Promise<Map<string, ShopifyProduct>> {
  const unique = [...new Set(variantIds.map(String))];
  const byVariant = new Map<string, ShopifyProduct>();
  if (unique.length === 0) return byVariant;

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const data: { nodes: Array<{ id: string; product: GqlProduct } | null> } = await storefrontQuery(
      `${PRODUCT_FIELDS}
      query VariantProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant { id product { ...PortalProduct } }
        }
      }`,
      { ids: batch.map(toVariantGid) }
    );
    for (const node of data.nodes) {
      if (!node?.product) continue;
      byVariant.set(String(gidToNumber(node.id)), mapProduct(node.product));
    }
  }
  return byVariant;
}

// ─── Customer tags ──────────────────────────────────────────────────────────
// Customer tags need the Admin API, which this build no longer uses (no custom
// app on the store). Dietary preferences are read as empty and saving them is
// disabled until they move to a Recharge-side store (e.g. a customer metafield).

export async function getCustomerTags(_shopifyCustomerId: string): Promise<string[]> {
  return [];
}

export async function setCustomerTags(_shopifyCustomerId: string, _tags: string[]): Promise<void> {
  throw new Error("Saving dietary preferences isn't available in this build (no Shopify Admin API access).");
}

// Walden shop tabs: every collection (smart + manual) published to Headless.
export const listShopCollections = listBundleCollections;

// ─── Selling plan discounts ─────────────────────────────────────────────────
// The subscribe-and-save discount lives on each product's Shopify selling plan
// (created by Recharge). Recharge plans carry the frequency in the
// "Order Frequency and Unit" option, e.g. "1-month".

export type SellingPlanDiscount = {
  /** "1-month", "2-month" … from the plan's "Order Frequency and Unit" option */
  frequency: string | null;
  percentage: number | null;
  fixedAmount: number | null;
  fixedPrice: number | null;
};

export async function getSellingPlanDiscounts(productIds: string[]): Promise<Map<string, SellingPlanDiscount[]>> {
  const unique = [...new Set(productIds.filter(Boolean).map(String))];
  const out = new Map<string, SellingPlanDiscount[]>();
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const data: {
      nodes: Array<{
        id: string;
        sellingPlanGroups?: {
          nodes: Array<{
            sellingPlans: {
              nodes: Array<{
                options: Array<{ name: string; value: string }>;
                priceAdjustments: Array<{
                  adjustmentValue:
                    | { __typename: "SellingPlanPercentagePriceAdjustment"; adjustmentPercentage: number }
                    | { __typename: "SellingPlanFixedAmountPriceAdjustment"; adjustmentAmount: { amount: string } }
                    | { __typename: "SellingPlanFixedPriceAdjustment"; price: { amount: string } };
                }>;
              }>;
            };
          }>;
        };
      } | null>;
    } = await storefrontQuery(
      `query SellingPlanDiscounts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            sellingPlanGroups(first: 10) {
              nodes {
                sellingPlans(first: 20) {
                  nodes {
                    options { name value }
                    priceAdjustments {
                      adjustmentValue {
                        __typename
                        ... on SellingPlanPercentagePriceAdjustment { adjustmentPercentage }
                        ... on SellingPlanFixedAmountPriceAdjustment { adjustmentAmount { amount } }
                        ... on SellingPlanFixedPriceAdjustment { price { amount } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { ids: batch.map((id) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`)) }
    );
    for (const node of data.nodes) {
      if (!node?.sellingPlanGroups) continue;
      const plans = node.sellingPlanGroups.nodes.flatMap((g) => g.sellingPlans.nodes);
      out.set(
        String(gidToNumber(node.id)),
        plans.map((p) => {
          const adj = p.priceAdjustments[0]?.adjustmentValue;
          return {
            frequency:
              p.options.find((o) => /frequency/i.test(o.name))?.value?.toLowerCase().replace(/\s+/g, "-") ?? null,
            percentage: adj?.__typename === "SellingPlanPercentagePriceAdjustment" ? adj.adjustmentPercentage : null,
            fixedAmount: adj?.__typename === "SellingPlanFixedAmountPriceAdjustment" ? Number(adj.adjustmentAmount.amount) : null,
            fixedPrice: adj?.__typename === "SellingPlanFixedPriceAdjustment" ? Number(adj.price.amount) : null,
          };
        })
      );
    }
  }
  return out;
}
