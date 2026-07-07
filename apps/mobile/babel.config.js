module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-worklets/plugin MUST be the last plugin (required by
    // Reanimated 4 / Stream Chat). See Stream Expo tutorial + Reanimated docs.
    plugins: ["react-native-worklets/plugin"],
  };
};
