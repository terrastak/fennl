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
    interface Tab {
      id?: number;
      url?: string;
    }
    function create(properties: { url: string }): Promise<Tab>;
    function query(query: {
      active?: boolean;
      currentWindow?: boolean;
      url?: string;
    }): Promise<Tab[]>;
  }
  namespace scripting {
    interface InjectionResult<T> {
      result?: T;
    }
    function executeScript<T>(injection: {
      target: { tabId: number };
      func: () => T;
    }): Promise<InjectionResult<Awaited<T>>[]>;
  }
  namespace permissions {
    interface Permissions {
      origins?: string[];
    }
    function contains(permissions: Permissions): Promise<boolean>;
    function request(permissions: Permissions): Promise<boolean>;
  }
  namespace runtime {
    function getManifest(): { version: string };
  }
}

/** Fennl's address (https://beta.fennl.app), set when the extension is built. */
declare const __FENNL_ORIGIN__: string;

/**
 * True only in the browser tests' build: the panel, opened as a tab, may be told which tab to
 * import (?target=), and the extension can read any page without the toolbar click.
 */
declare const __FENNL_TEST__: boolean;
