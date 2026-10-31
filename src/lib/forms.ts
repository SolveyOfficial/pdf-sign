// Reads and fills the fillable fields (AcroForm) of a PDF with pdf-lib.
import {
  PDFCheckBox,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  type PDFDocument,
  type PDFField,
} from "pdf-lib";

import { UserError } from "./errors";

export type FieldValue = string | boolean;

export interface FormField {
  /** Full name, unique in the document. */
  name: string;
  /** What to show to the user: the field's tooltip, or its name. */
  label: string;
  kind: "text" | "checkbox" | "choice" | "radio";
  value: FieldValue;
  options: string[];
  multiline: boolean;
  maxLength?: number;
  readOnly: boolean;
}

const tooltip = (field: PDFField) => {
  const value = field.acroField.dict.get(PDFName.of("TU"));
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText().trim()
    : "";
};

/** Lists the fields a user can fill in, in document order. */
export const readFields = (doc: PDFDocument): FormField[] => {
  let fields: PDFField[];
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }
  const list: FormField[] = [];
  for (const field of fields) {
    const name = field.getName();
    const base = {
      name,
      label: tooltip(field) || name,
      readOnly: field.isReadOnly(),
      options: [] as string[],
      multiline: false,
    };
    if (field instanceof PDFTextField) {
      list.push({
        ...base,
        kind: "text",
        value: field.getText() ?? "",
        multiline: field.isMultiline(),
        maxLength: field.getMaxLength(),
      });
    } else if (field instanceof PDFCheckBox) {
      list.push({ ...base, kind: "checkbox", value: field.isChecked() });
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      list.push({
        ...base,
        kind: "choice",
        value: field.getSelected()[0] ?? "",
        options: field.getOptions(),
      });
    } else if (field instanceof PDFRadioGroup) {
      list.push({
        ...base,
        kind: "radio",
        value: field.getSelected() ?? "",
        options: field.getOptions(),
      });
    }
    // buttons and signature fields cannot be filled in here
  }
  return list;
};

/** Writes values into the fields; fields not named in `values` are left alone. */
export const fillFields = (doc: PDFDocument, values: Record<string, FieldValue>) => {
  const names = Object.keys(values);
  if (!names.length) {
    return;
  }
  const form = doc.getForm();
  for (const name of names) {
    const value = values[name];
    const field = form.getFieldMaybe(name);
    try {
      if (field instanceof PDFTextField) {
        field.setText(String(value) || undefined);
      } else if (field instanceof PDFCheckBox) {
        if (value) {
          field.check();
        } else {
          field.uncheck();
        }
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (value) {
          field.select(String(value));
        } else {
          field.clear();
        }
      } else if (field instanceof PDFRadioGroup) {
        if (value) {
          field.select(String(value));
        } else {
          field.clear();
        }
      }
    } catch (error) {
      throw new UserError(
        `Could not fill in "${name}": ${error instanceof Error ? error.message : error}`,
      );
    }
  }
};
