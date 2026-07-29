import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { useCredentials } from "../../app/credentials-context";

export type StorageMode = "session" | "persistent";

export interface StorageModeSelectorProps {
  readonly token: string;
  readonly maskedIdentifier?: string;
  readonly onModeSelected?: (mode: StorageMode) => void;
}

export function StorageModeSelector({
  token,
  maskedIdentifier = "",
  onModeSelected,
}: Readonly<StorageModeSelectorProps>): ReactElement {
  const credentials = useCredentials();
  const [selectedMode, setSelectedMode] = useState<StorageMode | null>(
    credentials.mode,
  );
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const suffix = (token.length > 0 ? token : maskedIdentifier).slice(-4);

  useEffect(() => {
    if (confirmationOpen) {
      confirmButtonRef.current?.focus();
    }
  }, [confirmationOpen]);

  const selectSession = useCallback(async (): Promise<void> => {
    if (token.length === 0 || pending) {
      return;
    }
    setPending(true);
    try {
      await credentials.setSessionToken(token, suffix);
      setSelectedMode("session");
      setConfirmationOpen(false);
      onModeSelected?.("session");
    } finally {
      setPending(false);
    }
  }, [credentials, onModeSelected, pending, suffix, token]);

  const requestPersistent = useCallback((): void => {
    if (token.length === 0 || pending) {
      return;
    }
    setSelectedMode("persistent");
    setConfirmationOpen(true);
  }, [pending, token]);

  const confirmPersistent = useCallback(async (): Promise<void> => {
    if (token.length === 0 || pending) {
      return;
    }
    setPending(true);
    try {
      await credentials.setPersistentToken(token, suffix);
      setSelectedMode("persistent");
      setConfirmationOpen(false);
      onModeSelected?.("persistent");
    } finally {
      setPending(false);
    }
  }, [credentials, onModeSelected, pending, suffix, token]);

  const declinePersistent = useCallback((): void => {
    void selectSession();
  }, [selectSession]);

  return (
    <fieldset
      className="td-storage-mode-selector"
      data-testid="storage-mode-selector"
      disabled={pending || token.length === 0}
    >
      <legend>Token storage</legend>
      <p>
        Token identifier: <code>…{suffix}</code>. Only the last four characters
        are shown.
      </p>
      <label>
        <input
          type="radio"
          name="storage-mode"
          value="session"
          checked={selectedMode === "session"}
          onChange={() => {
            void selectSession();
          }}
        />
        Session-only
      </label>
      <p>
        Keeps the token in memory for the current session and requires it again
        next time.
      </p>
      <label>
        <input
          type="radio"
          name="storage-mode"
          value="persistent"
          checked={selectedMode === "persistent"}
          onChange={requestPersistent}
        />
        Persistent
      </label>
      <p>
        Stores the token locally only after you review and confirm the risks.
      </p>

      {confirmationOpen && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="persistent-storage-title"
          aria-describedby="persistent-storage-disclosure"
          data-testid="persistent-confirmation"
        >
          <h3 id="persistent-storage-title">Confirm persistent storage</h3>
          <div id="persistent-storage-disclosure">
            <p>
              Your Asana personal access token is sensitive. Anyone who obtains
              it may access the Asana data allowed by that token.
            </p>
            <p>
              The token is encrypted at rest with AES-GCM and a non-extractable
              key. This reduces opportunistic access to copied browser storage,
              but it cannot protect the token from an attacker who can execute
              scripts in this application&apos;s origin.
            </p>
            <p>
              The stored token remains on this device and in this browser
              profile until you switch to session-only storage or clear local
              data.
            </p>
          </div>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={() => void confirmPersistent()}
          >
            Confirm persistent storage
          </button>
          <button type="button" onClick={declinePersistent}>
            Decline
          </button>
        </div>
      )}
    </fieldset>
  );
}
