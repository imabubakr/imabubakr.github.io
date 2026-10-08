// Contour coordinates are whole metres, so integer precision loses nothing visible.
export default {
  multipass: true,
  floatPrecision: 0,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // Keep the <style> block: it reads the page's CSS custom properties.
          inlineStyles: false,
        },
      },
    },
  ],
};
