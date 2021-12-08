module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:prettier/recommended"],
  parser: "babel-eslint",
  plugins: ["prettier"],
  rules: {
    "prettier/prettier": "warn",
    "no-debugger": "warn",
  },
};
