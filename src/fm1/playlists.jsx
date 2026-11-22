import { useMemo, useState } from "react";

const EMPTY = [];

export function usePlaylists(config, setConfig) {
  const [activeId, setActive] = useState("");
  const [name, setName] = useState("");
  const lists = config.playlists || EMPTY;
  return useMemo(() => {
    const active = lists.find((list) => list.id === activeId);
    const update = (transform) =>
      setConfig((prev) => ({
        ...prev,
        playlists: transform(prev.playlists || []),
      }));

    const toolbar = (
      <form
        className="fm-hardware mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          const id = crypto.randomUUID();
          update((all) => [...all, { id, name: name.trim(), ids: [] }]);
          setName("");
          setActive(id);
        }}
      >
        <label>
          Playlist{" "}
          <select value={activeId} onChange={(e) => setActive(e.target.value)}>
            <option value="">All tracks</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="New playlist name"
          placeholder="New playlist name"
          value={name}
          maxLength={70}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={!name.trim()}>
          Create playlist
        </button>
        {active && (
          <button
            type="button"
            onClick={() => {
              update((all) => all.filter((list) => list.id !== activeId));
              setActive("");
            }}
          >
            Delete playlist
          </button>
        )}
      </form>
    );

    const membership = (trackId) =>
      active ? (
        <button
          type="button"
          className="text-sm"
          onClick={() =>
            update((all) =>
              all.map((list) =>
                list.id !== activeId
                  ? list
                  : { ...list, ids: list.ids.filter((id) => id !== trackId) },
              ),
            )
          }
        >
          Remove from playlist
        </button>
      ) : (
        lists.length > 0 && (
          <select
            aria-label="Add track to playlist"
            value=""
            onChange={(event) => {
              const id = event.target.value;
              update((all) =>
                all.map((list) =>
                  list.id !== id || list.ids.includes(trackId)
                    ? list
                    : { ...list, ids: [...list.ids, trackId] },
                ),
              );
            }}
          >
            <option value="">Add to playlist</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        )
      );
    return { active, toolbar, membership };
  }, [activeId, name, lists, setConfig]);
}
