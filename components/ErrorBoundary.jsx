import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <h2>Something went wrong while rendering this page.</h2>
          <div style={{ marginTop: 12, color: '#666' }}>{String(this.state.error?.message || this.state.error)}</div>
          <div style={{ marginTop: 16 }}>
            <button onClick={() => window.location.reload()}>Reload page</button>
            <button onClick={() => (window.location.href = '/')} style={{ marginLeft: 8 }}>Go to Home</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
