import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { matchesSettingsEntry, SETTINGS_SEARCH_ENTRIES } from "./settingsSearchIndex";

/**
 * Find a setting by what you want to change, not by which page owns it.
 *
 * The pages are organised by subsystem; people look for settings by outcome ("通知", "字数", "放行").
 * The hint about per-book settings is part of the answer, not decoration: most "I cannot find the
 * setting" reports come from looking in the global settings for something that is set on the book.
 */
export default function SettingsFinder() {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const results = useMemo(
    () => SETTINGS_SEARCH_ENTRIES.filter((entry) => matchesSettingsEntry(entry, query)),
    [query],
  );

  return <div className="space-y-2">
    <label htmlFor="settings-finder" className="block text-sm font-medium">找设置</label>
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id="settings-finder"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="输入你想改的东西，例如：通知、字数、API Key、深色、自动放行"
        className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
    <p className="text-xs text-muted-foreground">
      这里列出的是<strong className="font-medium text-foreground">全局</strong>设置。想改某一本书的字数、书名或写法，去那本书的「小说基础信息」，不在这里。
    </p>
    {searching ? <ul className="space-y-2">
      {results.length === 0 ? <li className="text-sm text-muted-foreground">
        没找到这一项。换个说法再试（例如用「通知」「模型」「写法」这类词），或按下面的分类逐页看。
      </li> : null}
      {results.map((entry) => <li key={entry.label} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
        <div className="min-w-0">
          <div className="text-sm font-medium">{entry.label}</div>
          <div className="text-xs text-muted-foreground">在「{entry.where}」</div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0"><Link to={entry.to}>去这里</Link></Button>
      </li>)}
    </ul> : null}
  </div>;
}
