import { PublicNav } from "@/components/shells/public-nav";
import { PublicFooter } from "@/components/shells/public-footer";
import { ChatWidget } from "@/components/chatbot/chat-widget";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <PublicNav />
      <div style={{ flex: 1 }}>{children}</div>
      <PublicFooter />
      <ChatWidget />
    </div>
  );
}
