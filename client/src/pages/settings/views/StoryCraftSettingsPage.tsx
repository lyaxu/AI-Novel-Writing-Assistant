import { useState } from "react";
import StoryCraftSettingsSection from "../StoryCraftSettingsSection";
import SettingsActionResult from "../SettingsActionResult";
import { SettingsShell } from "../components/SettingsShell";

export default function StoryCraftSettingsPage() {
  const [message, setMessage] = useState("");
  return (
    <SettingsShell
      title="通用创作规则"
      description="为所有书设定故事推进、章节交付、人物规模和特殊能力的底线。AI 会按每本书的题材把这些规则写成具体安排。"
    >
      <StoryCraftSettingsSection onActionResult={setMessage} />
      <SettingsActionResult message={message} />
    </SettingsShell>
  );
}
