"use client";
// Admin categories & skills (provider-admin spec §10): category grid, skill
// chip cloud with delete, inline add-category / add-skill forms wired to the
// real REST API (improvement over the prototype's demo-only buttons).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";

type CategoryRow = { id: string; nameAr: string; nameEn: string; count: number };
type SkillRow = { id: string; name: string; categoryId: string; categoryAr: string; categoryEn: string };

const inputStyle: React.CSSProperties = {
  border: "1px solid #E4E9F1",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 600,
  color: "#2C3A54",
  background: "#fff",
  outline: "none",
};

export function CategoriesScreen({ categories, skills }: { categories: CategoryRow[]; skills: SkillRow[] }) {
  const { t, isAr, pick } = useI18n();
  const router = useRouter();

  const [catFormOpen, setCatFormOpen] = useState(false);
  const [skillFormOpen, setSkillFormOpen] = useState(false);
  const [catNameAr, setCatNameAr] = useState("");
  const [catNameEn, setCatNameEn] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillCatId, setSkillCatId] = useState(categories[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const addCategory = async () => {
    if (catNameAr.trim().length < 2 || catNameEn.trim().length < 2) return;
    setBusy("cat");
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameAr: catNameAr.trim(), nameEn: catNameEn.trim() }),
      });
      if (res.ok) {
        setCatNameAr("");
        setCatNameEn("");
        setCatFormOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const addSkill = async () => {
    if (!skillName.trim() || !skillCatId) return;
    setBusy("skill");
    try {
      const res = await fetch("/api/admin/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: skillName.trim(), categoryId: skillCatId }),
      });
      if (res.ok) {
        setSkillName("");
        setSkillFormOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const deleteSkill = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/admin/skills/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>{t.aNavCats}</h1>

      {/* Categories grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {categories.map((c) => (
          <div
            key={c.id}
            style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 14, padding: "18px 20px" }}
          >
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "#2C3A54", marginBottom: 3 }}>
              {pick(c.nameAr, c.nameEn)}
            </div>
            <div style={{ fontSize: 12.5, color: "#93A1B8" }}>
              {fmtNum(c.count)} {t.catProject}
            </div>
          </div>
        ))}
      </div>

      {/* Skills section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "34px 0 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{t.skillsT}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setCatFormOpen((v) => !v)}
            className="hover:bg-[#E1E9F6]"
            style={{
              background: "#EEF3FB",
              color: "#1B3568",
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "7px 16px",
              borderRadius: 999,
            }}
          >
            {t.addCatBtn}
          </button>
          <button
            onClick={() => setSkillFormOpen((v) => !v)}
            className="hover:bg-[#D3EDEF]"
            style={{
              background: "#E8F5F6",
              color: "#0E7A81",
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "7px 16px",
              borderRadius: 999,
            }}
          >
            {t.addSkillBtn2}
          </button>
        </div>
      </div>

      {/* Inline add-category form */}
      {catFormOpen && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E4E9F1",
            borderRadius: 14,
            padding: 16,
            marginBottom: 14,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            value={catNameAr}
            onChange={(e) => setCatNameAr(e.target.value)}
            placeholder={isAr ? "الاسم بالعربية" : "Arabic name"}
            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          />
          <input
            dir="ltr"
            value={catNameEn}
            onChange={(e) => setCatNameEn(e.target.value)}
            placeholder={isAr ? "الاسم بالإنجليزية" : "English name"}
            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          />
          <button
            onClick={addCategory}
            disabled={busy === "cat"}
            className="hover:bg-[#24437F]"
            style={{
              background: "#1B3568",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 20px",
              borderRadius: 10,
              opacity: busy === "cat" ? 0.6 : 1,
            }}
          >
            {isAr ? "حفظ" : "Save"}
          </button>
        </div>
      )}

      {/* Inline add-skill form */}
      {skillFormOpen && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E4E9F1",
            borderRadius: 14,
            padding: 16,
            marginBottom: 14,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            dir="ltr"
            value={skillName}
            onChange={(e) => setSkillName(e.target.value)}
            placeholder={isAr ? "اسم المهارة" : "Skill name"}
            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          />
          <select
            value={skillCatId}
            onChange={(e) => setSkillCatId(e.target.value)}
            style={{ ...inputStyle, minWidth: 180, cursor: "pointer" }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {pick(c.nameAr, c.nameEn)}
              </option>
            ))}
          </select>
          <button
            onClick={addSkill}
            disabled={busy === "skill"}
            className="hover:bg-[#14969E]"
            style={{
              background: "#0E7A81",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 20px",
              borderRadius: 10,
              opacity: busy === "skill" ? 0.6 : 1,
            }}
          >
            {isAr ? "حفظ" : "Save"}
          </button>
        </div>
      )}

      {/* Skill chip cloud */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E4E9F1",
          borderRadius: 18,
          padding: 22,
          display: "flex",
          flexWrap: "wrap",
          gap: 9,
        }}
      >
        {skills.length === 0 && <span style={{ fontSize: 13.5, color: "#93A1B8" }}>—</span>}
        {skills.map((sk) => (
          <span
            key={sk.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#FBFCFE",
              border: "1px solid #E4E9F1",
              borderRadius: 999,
              padding: "6px 7px 6px 14px",
              whiteSpace: "nowrap",
              opacity: busy === sk.id ? 0.5 : 1,
            }}
          >
            <span dir="ltr" style={{ fontSize: 13, fontWeight: 600, color: "#2C3A54", whiteSpace: "nowrap" }}>
              {sk.name}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#7684A0",
                background: "#F0F3F8",
                borderRadius: 999,
                padding: "2px 10px",
                whiteSpace: "nowrap",
              }}
            >
              {pick(sk.categoryAr, sk.categoryEn)}
            </span>
            <button
              onClick={() => deleteSkill(sk.id)}
              disabled={busy === sk.id}
              className="hover:text-[#B0433A]!"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: "#93A1B8",
                padding: "0 2px",
                lineHeight: 1,
              }}
              aria-label={sk.name}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
