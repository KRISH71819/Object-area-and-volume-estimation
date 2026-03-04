import React from 'react';
import type { DeviceCapabilities } from '../types';

interface Props {
  capabilities: DeviceCapabilities | null;
}

export const Header: React.FC<Props> = ({ capabilities }) => {
  const arLabel = capabilities?.hasLiDAR
    ? '🎯 LiDAR Active'
    : capabilities?.hasWebXR
      ? '📡 AR Ready'
      : '📷 Camera Mode';

  return (
    <header className="app-header">
      <h1>PixScale</h1>
      <p className="subtitle">AI-Powered Area Measurement</p>
      <span className="header-badge">
        {arLabel}
      </span>
    </header>
  );
};
