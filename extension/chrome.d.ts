// The few Chrome extension APIs the Fennl extension uses (phase E5), typed by hand rather than
// adding a package for them. See developer.chrome.com/docs/extensions/reference.

declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
  }
  namespace tabs {
    function create(properties: { url: string }): Promise<unknown>;
  }
  namespace runtime {
    function getManifest(): { version: string };
  }
}

/** Fennl's address (https://beta.fennl.app), set when the extension is built. */
declare const __FENNL_ORIGIN__: string;
