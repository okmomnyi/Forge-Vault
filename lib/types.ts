export type Condition = 'new' | 'used' | 'refurbished';
export type StockStatus = 'in_stock' | 'preorder' | 'out_of_stock';

export const CONDITIONS: Condition[] = ['new', 'used', 'refurbished'];
export const STOCK_STATUSES: StockStatus[] = ['in_stock', 'preorder', 'out_of_stock'];

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface PartImage {
  id: string;
  image_url: string;
  delete_url: string | null;
  sort_order: number;
}

/** An image as tracked in the admin form before/after upload. */
export interface UploadedImage {
  url: string;
  delete_url: string | null;
}

export interface Compatibility {
  id?: string;
  make: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
}

export interface Part {
  id: string;
  name: string;
  slug: string;
  part_number: string | null;
  category_id: number | null;
  description: string | null;
  price_kes: string; // NUMERIC comes back as a string from pg
  condition: Condition;
  stock_status: StockStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A part joined with its category name, images, and compatibility rows. */
export interface PartDetail extends Part {
  category_name: string | null;
  category_slug: string | null;
  images: PartImage[];
  compatibility: Compatibility[];
}

/** Row shape for the admin dashboard table + public card. */
export interface PartListItem {
  id: string;
  name: string;
  slug: string;
  part_number: string | null;
  price_kes: string;
  condition: Condition;
  stock_status: StockStatus;
  is_active: boolean;
  updated_at: string;
  category_name: string | null;
  primary_image: string | null;
}
