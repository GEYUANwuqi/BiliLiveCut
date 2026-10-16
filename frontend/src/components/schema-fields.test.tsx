import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SchemaFields, normalizeSchema } from "./schema-fields";
it("keeps incomplete JSON edits visible until the user completes them", () => {
  function Editor() {
    const [value, setValue] = useState<unknown>({});
    return (
      <SchemaFields
        schema={{ type: "object", additionalProperties: { type: "string" } }}
        value={value}
        onChange={setValue}
      />
    );
  }
  render(<Editor />);
  const field = screen.getByRole("textbox");
  fireEvent.change(field, { target: { value: '{"alias"' } });
  expect(field).toHaveValue('{"alias"');
  expect(() => normalizeSchema({ type: "object" }, '{"alias"')).toThrow("JSON");
  fireEvent.change(field, { target: { value: '{"alias":"名称"}' } });
  expect(field).toHaveValue('{"alias":"名称"}');
});
