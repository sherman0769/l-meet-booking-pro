export async function verifyAdminAccess(): Promise<boolean> {
  const checkSession = async () => {
    try {
      const response = await fetch("/api/admin/service-buffers", {
        method: "GET",
      });
      return response.status;
    } catch (error) {
      console.error("admin session 檢查失敗：", error);
      return 0;
    }
  };

  const initialSessionStatus = await checkSession();

  if (initialSessionStatus === 200) {
    return true;
  }

  if (initialSessionStatus !== 401) {
    alert("驗證失敗，請稍後再試");
    window.location.href = "/";
    return false;
  }

  const pwd = prompt("請輸入管理密碼");

  if (!pwd) {
    alert("未輸入密碼");
    window.location.href = "/";
    return false;
  }

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: pwd,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data?.success) {
      alert("密碼錯誤");
      window.location.href = "/";
      return false;
    }

    const secondSessionStatus = await checkSession();

    if (secondSessionStatus === 200) {
      return true;
    }

    alert("登入失敗，Session 驗證未通過");
    window.location.href = "/";
    return false;
  } catch (error) {
    console.error("admin 驗證失敗：", error);
    alert("驗證失敗，請稍後再試");
    window.location.href = "/";
    return false;
  }
}
