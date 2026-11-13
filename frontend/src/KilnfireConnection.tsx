import { useId, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, Unplug } from "lucide-react";
import { api, useApi, type KilnfireStatus } from "./api";
import { ErrorMessage, Field, Loading } from "./components";

export function KilnfireConnection() {
  const query = useApi<KilnfireStatus>("/kilnfire");
  const client = useQueryClient();
  const [address, setAddress] = useState<string | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState<unknown>(null);
  const status = query.data;
  const connected = status?.state === "connected";
  const formId = useId();

  async function change(
    action: string,
    path: string,
    method: string,
    body?: unknown,
  ) {
    setPending(action);
    setError(null);
    try {
      if (action === "login")
        await api<KilnfireStatus>("/kilnfire", "PUT", {
          endpoint: address ?? status?.endpoint ?? "",
        });
      const result = await api<KilnfireStatus>(path, method, body);
      client.setQueryData(["/kilnfire"], result);
      await client.invalidateQueries();
      if (action === "login") setAddress(null);
    } catch (error) {
      setError(error);
      await client.invalidateQueries({ queryKey: ["/kilnfire"] });
    } finally {
      setPending("");
    }
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (connected || pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    // Credentials stay out of React state, drafts, and the mutation cache.
    const body = {
      email: String(values.get("email")),
      password: String(values.get("password")),
    };
    form.reset();
    void change("login", "/kilnfire/login", "POST", body);
  }

  return (
    <section
      id="kilnfire"
      tabIndex={-1}
      className="settings-section"
      aria-labelledby="kilnfire-heading"
    >
      <div className="settings-section-heading">
        <h2 id="kilnfire-heading">Kilnfire</h2>
        {connected ? (
          <button
            type="button"
            className="button secondary"
            disabled={!!pending}
            onClick={() => void change("disconnect", "/kilnfire", "DELETE")}
          >
            <Unplug size={16} aria-hidden="true" />
            {pending === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="submit"
            form={formId}
            className="button primary"
            disabled={query.isPending || !!pending}
          >
            <LogIn size={16} aria-hidden="true" />
            {pending === "login" ? "Signing in…" : "Sign in"}
          </button>
        )}
      </div>
      <div className="settings-row kilnfire-connection">
        <ErrorMessage error={query.error || error} />
        {query.isPending ? (
          <Loading />
        ) : (
          <>
            <form
              id={formId}
              className="record-form kilnfire-login-form"
              aria-label="Kilnfire sign in"
              onSubmit={signIn}
              autoComplete="off"
            >
              <div
                className={`kilnfire-login-fields${connected ? " is-connected" : ""}`}
              >
                <Field label="Studio address">
                  <input
                    type="url"
                    required
                    maxLength={253}
                    placeholder="https://marinpottery.kilnfire.com"
                    value={address ?? status?.endpoint ?? ""}
                    disabled={!!pending}
                    readOnly={connected}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </Field>
                {!connected && (
                  <>
                    <Field label="Email">
                      <input
                        name="email"
                        type="email"
                        autoComplete="off"
                        required
                        maxLength={254}
                        disabled={!!pending}
                      />
                    </Field>
                    <Field label="Password">
                      <input
                        name="password"
                        type="password"
                        autoComplete="off"
                        required
                        maxLength={4096}
                        disabled={!!pending}
                      />
                    </Field>
                  </>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
