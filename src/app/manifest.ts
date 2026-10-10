import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: `${BRAND.name} / ${BRAND.nameAr}`, short_name: BRAND.nameAr,
    description: "حملاتك وتعاوناتك مع صنّاع المحتوى، في مكان واحد.",
    lang: "ar", dir: "rtl", start_url: "/", scope: "/", display: "standalone",
    background_color: "#faf9f4", theme_color: "#fffc00",
    icons: [
      { src: "/icons/infame-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/infame-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/infame-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
