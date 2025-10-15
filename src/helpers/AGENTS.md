# helpers folder

- Place helper functions. A helper function is a single-step functionality to be re-used through out the code base.
- Each functionality is exported as a single function.
- These functions are not meant to be used within the test folder or sub-folders, except for being unit-tested themselves.

## General Instructions:

- Prefer grouping functions that deal with the same type of variable within the
same file, preferably named after the type name. E.g.: use `helpers/string.js` for
exporting helper functions that handle strings, or e.g.: use helpers/stream.js` to
deal with streams.
