"use client";

// ② 사람 찾기. 이름·부서로 찾아 여러 명을 고른다 (캘린더 참석자, DM 상대, 채널 멤버 추가에서 쓴다).
// 한 명만 고를 때는 max={1}.

import { useEffect, useId, useState } from "react";
import type { Person } from "@/lib/types/people";
import { searchPeople } from "./directory";
import s from "./people.module.css";

export default function PeoplePicker({
  value,
  onChange,
  exclude = [],
  max,
  placeholder = "이름·부서로 찾기",
}: {
  value: Person[];
  onChange: (people: Person[]) => void;
  /** 결과에서 뺄 사람 (예: 나 자신) */
  exclude?: string[];
  max?: number;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const listId = useId();
  const full = max !== undefined && value.length >= max;
  // 배열은 렌더마다 새로 만들어지므로 글자로 바꿔 비교한다 (효과가 끝없이 다시 돌지 않게)
  const hiddenKey = [...exclude, ...value.map((p) => p.id)].join(",");

  useEffect(() => {
    let alive = true;
    const hidden = new Set(hiddenKey.split(","));
    // 입력이 멈춘 뒤에 찾는다 (DB 로 바뀌면 글자마다 요청하지 않도록)
    const timer = setTimeout(() => {
      void searchPeople(query).then((found) => {
        if (alive) setResults(found.filter((p) => !hidden.has(p.id)));
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, hiddenKey]);

  function add(p: Person) {
    if (value.some((v) => v.id === p.id)) return; // Enter 를 빠르게 두 번 눌러도 한 번만
    onChange([...value, p]);
    setQuery("");
    setResults([]); // 다음 검색 결과가 오기 전까지 이전 결과를 고르지 못하게
  }

  return (
    <div className={s.picker}>
      {value.length > 0 && (
        <ul className={s.chips} aria-label="고른 사람">
          {value.map((p) => (
            <li key={p.id} className={s.chip}>
              {p.display_name}
              <button
                type="button"
                aria-label={`${p.display_name} 빼기`}
                onClick={() => onChange(value.filter((v) => v.id !== p.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <input
          type="search"
          role="combobox"
          // 검색어가 있을 때 Esc 는 검색어만 지운다 — 바깥 대화상자(sidebar/Modal)가 이 표시를 보고 닫지 않는다
          data-own-escape={query ? "" : undefined}
          aria-expanded={results.length > 0}
          aria-controls={listId}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setResults([]); // 새 글자에 맞는 결과가 오기 전에는 비워 둔다
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // 폼 제출을 막고 첫 결과를 고른다
              if (query.trim() && results[0]) add(results[0]);
            } else if (e.key === "Escape" && query) {
              e.preventDefault(); // 헤더의 채널 목록도 이 표시(defaultPrevented)를 보고 닫지 않는다
              e.stopPropagation(); // 대화상자까지 닫지 않고 검색어만 지운다
              setQuery("");
              setResults([]);
            }
          }}
        />
      )}
      {!full && query.trim() && (
        <ul id={listId} className={s.results} role="listbox">
          {results.length === 0 ? (
            <li className={s.empty}>찾는 사람이 없습니다</li>
          ) : (
            results.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => add(p)}>
                  <span className={s.name}>{p.display_name}</span>
                  <span className={s.meta}>
                    {[p.department, p.title].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
