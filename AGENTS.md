# Working in this repository

Read `PURPOSE.md` first: it says what the protocol is for and how choices in it are made. Then
`guide.md`, which is the contract; `README.md` says where everything else is.

- `guide.md` and `guide/` are normative. A change to the contract changes the guide, the types in
  `src/index.ts` and the checks in `src/validation.ts` and `src/testing.ts` together.
- This repository is public: committed text and pull requests name nothing internal.
- Pending work lives in `.agent-memory/todo.md`, never here.
