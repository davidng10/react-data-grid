// React 18 forwards inert as a string; React 19 treats it as a boolean. A truthy
// string other than "true"/"false" emits the attribute without warnings in both.
// The cast accommodates React 19's boolean-only JSX type; DOM presence is the contract.
export const inertAttribute = "inert" as unknown as boolean;
