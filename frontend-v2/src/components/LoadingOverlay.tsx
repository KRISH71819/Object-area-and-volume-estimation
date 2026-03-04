import React from 'react';

interface Props {
  active: boolean;
  text: string;
  progress?: string;
}

export const LoadingOverlay: React.FC<Props> = ({ active, text, progress }) => {
  return (
    <div className={`loading-overlay ${active ? 'active' : ''}`} id="loading-overlay">
      <div className="loading-spinner" />
      <p className="loading-text">{text || 'Processing...'}</p>
      {progress && <p className="loading-progress">{progress}</p>}
    </div>
  );
};
