package com.barangayresolve.app;

import java.util.Locale;

/** Small helpers for the JavaScript snippets the native layer evaluates. */
public final class Js {

  private Js() {}

  /** A JavaScript/JSON string literal, safe to inline into evaluated code. */
  public static String quote(String value) {
    if (value == null) return "\"\"";
    StringBuilder sb = new StringBuilder();
    sb.append('"');
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"':
          sb.append("\\\"");
          break;
        case '\\':
          sb.append("\\\\");
          break;
        case '\n':
          sb.append("\\n");
          break;
        case '\r':
          sb.append("\\r");
          break;
        case '\t':
          sb.append("\\t");
          break;
        case '<':
          // Never let a report terminate the <script> context it is injected in.
          sb.append("\\u003c");
          break;
        case '>':
          sb.append("\\u003e");
          break;
        default:
          if (c < 0x20) {
            sb.append(String.format(Locale.US, "\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
      }
    }
    return sb.append("\"").toString();
  }
}
