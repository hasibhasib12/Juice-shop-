"use client";

import { useEffect, useMemo, useState } from "react";

type Product = { id: string; name: string; category: string; priceMinor: number; currency: string; image: string };
type CartLine = { product: Product; quantity: number };

const money = (amountMinor: number, currency = "AFN") => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(amountMinor / 100);
