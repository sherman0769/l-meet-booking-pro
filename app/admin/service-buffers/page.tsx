"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { verifyAdminAccess } from "@/lib/admin-auth";

type ServiceBuffers = {
  健身: number;
  AI課程: number;
  咨詢: number;
  顧問: number;
};

const DEFAULT_BUFFERS: ServiceBuffers = {
  健身: 30,
  AI課程: 0,
  咨詢: 0,
  顧問: 0,
};

export default function ServiceBuffersPage() {
  const router = useRouter();
  const [buffers, setBuffers] = useState<ServiceBuffers>(DEFAULT_BUFFERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const ok = await verifyAdminAccess();

      if (ok) {
        setAuthorized(true);
      }
    };

    checkAuth();
  }, []);

  useEffect(() => {
    const fetchBuffers = async () => {
      try {
        setLoading(true);
        setMessage("");

        const res = await fetch("/api/admin/service-buffers");
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || "讀取失敗");
        }

        if (data?.buffers) {
          setBuffers({
            健身: Number(data.buffers.健身 ?? 0),
            AI課程: Number(data.buffers.AI課程 ?? 0),
            咨詢: Number(data.buffers.咨詢 ?? 0),
            顧問: Number(data.buffers.顧問 ?? 0),
          });
        }
      } catch (error) {
        console.error("讀取 service buffers 失敗：", error);
        setMessage("讀取失敗，請查看 console");
      } finally {
        setLoading(false);
      }
    };

    if (!authorized) return;

    fetchBuffers();
  }, [authorized]);

  const handleChange = (key: keyof ServiceBuffers, value: string) => {
    const n = Number(value);

    setBuffers((prev) => ({
      ...prev,
      [key]: Number.isFinite(n) && n >= 0 ? n : 0,
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage("");

      const res = await fetch("/api/admin/service-buffers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          buffers,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "儲存失敗");
      }

      setBuffers({
        健身: Number(data.buffers.健身 ?? 0),
        AI課程: Number(data.buffers.AI課程 ?? 0),
        咨詢: Number(data.buffers.咨詢 ?? 0),
        顧問: Number(data.buffers.顧問 ?? 0),
      });

      setMessage("儲存成功");
    } catch (error) {
      console.error("儲存 service buffers 失敗：", error);
      setMessage("儲存失敗，請查看 console");
    } finally {
      setSaving(false);
    }
  };

  if (!authorized) {
    return (
      <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-md p-6 w-full max-w-lg text-center">
          驗證中...
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-md p-6 w-full max-w-lg text-center">
          讀取中...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-md p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">服務 Buffer 設定</h1>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/api/auth/google";
              }}
              className="text-sm px-3 py-2 rounded-lg bg-orange-600 text-white hover:opacity-90"
            >
              重新授權 Calendar
            </button>

            <button
              type="button"
              onClick={() => router.push("/admin")}
              className="text-sm px-3 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
            >
              返回後台
            </button>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          可設定各服務在 Calendar busy 判斷時額外保留的分鐘數
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">健身</label>
            <input
              type="number"
              min={0}
              step={1}
              value={buffers.健身}
              onChange={(e) => handleChange("健身", e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">AI課程</label>
            <input
              type="number"
              min={0}
              step={1}
              value={buffers.AI課程}
              onChange={(e) => handleChange("AI課程", e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">咨詢</label>
            <input
              type="number"
              min={0}
              step={1}
              value={buffers.咨詢}
              onChange={(e) => handleChange("咨詢", e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">顧問</label>
            <input
              type="number"
              min={0}
              step={1}
              value={buffers.顧問}
              onChange={(e) => handleChange("顧問", e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-black text-white py-3 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "儲存中..." : "儲存設定"}
          </button>

          {message && (
            <div className="text-sm rounded-lg bg-gray-100 px-3 py-2">
              {message}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
