import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const catalog = [
  { name: "Orange Juice", category: "Juices", price: 8000, image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=700&q=85" },
  { name: "Mango Juice", category: "Juices", price: 9000, image: "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=700&q=85" },
  { name: "Pomegranate Juice", category: "Juices", price: 10000, image: "https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=700&q=85" },
  { name: "Berry Blast", category: "Smoothies", price: 10000, image: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?auto=format&fit=crop&w=700&q=85" },
  { name: "Strawberry Smoothie", category: "Smoothies", price: 11000, image: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=700&q=85" },
  { name: "Banana Smoothie", category: "Smoothies", price: 11000, image: "https://images.unsplash.com/photo-1570696516188-ade861b84a49?auto=format&fit=crop&w=700&q=85" },
  { name: "Classic Milkshake", category: "Milkshakes", price: 10000, image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=700&q=85" },
  { name: "Chocolate Milkshake", category: "Milkshakes", price: 12000, image: "https://images.unsplash.com/photo-1577805947697-89e18249d767?auto=format&fit=crop&w=700&q=85" },
  { name: "Chocolate Cake", category: "Desserts", price: 13000, image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=700&q=85" },
  { name: "Fruit Dessert", category: "Desserts", price: 10000, image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=700&q=85" },
];

async function main() {
  const categoryIds = new Map<string, string>();
  for (const [index, name] of ["Juices", "Smoothies", "Milkshakes", "Desserts"].entries()) {
    const category = await prisma.category.upsert({
      where: { name },
      update: { active: true, sortOrder: index },
      create: { name, sortOrder: index },
    });
    categoryIds.set(name, category.id);
  }

  for (const [index, item] of catalog.entries()) {
    await prisma.product.upsert({
      where: { sku: `DEMO-${String(index + 1).padStart(3, "0")}` },
      update: {
        name: item.name,
        priceMinor: item.price,
        currency: "AFN",
        imageUrl: item.image,
        available: true,
        status: "ACTIVE",
        categoryId: categoryIds.get(item.category)!,
      },
      create: {
        sku: `DEMO-${String(index + 1).padStart(3, "0")}`,
        name: item.name,
        priceMinor: item.price,
        currency: "AFN",
        imageUrl: item.image,
        categoryId: categoryIds.get(item.category)!,
      },
    });
  }
  console.log(`Seeded ${catalog.length} demo products in 4 categories.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
