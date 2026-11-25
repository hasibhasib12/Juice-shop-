import type { Metadata } from "next";
import Storefront from "./storefront";

export const metadata: Metadata = {
  title: "Juice Shop | Freshness in every sip",
  description: "Discover fresh juices, smoothies and delicious favourites from Juice Shop.",
};

export default function ShopPage() {
  return <Storefront />;
}
