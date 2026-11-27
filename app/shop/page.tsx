import type { Metadata } from "next";
import Storefront from "./storefront";

export const metadata: Metadata = {
  title: "ANAR & CO. | Menu",
  description: "Explore the ANAR & CO. menu."
};

export default function ShopPage() {
  return <Storefront />;
}
