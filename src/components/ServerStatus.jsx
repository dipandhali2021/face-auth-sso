import { useState, useEffect } from 'react';
import './ServerStatus.css';

const ServerStatus = () => {
  const [serverStatus, setServerStatus] = useState({
    isChecking: true,
    isOnline: false,
    error: null
  });

  // Get the OAuth server URL from environment variables
  const OAUTH_SERVER_URL = import.meta.env.VITE_OAUTH_SERVER_URL || 'http://localhost:5000';

  useEffect(() => {
    const checkServerStatus = async () => {
      try {
        const response = await fetch(`${OAUTH_SERVER_URL}/api/status`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Server status:', data);
          setServerStatus({
            isChecking: false,
            isOnline: true,
            details: data
          });
        } else {
          setServerStatus({
            isChecking: false,
            isOnline: false,
            error: `Server responded with status: ${response.status}`
          });
        }
      } catch (error) {
        console.error('Failed to connect to authentication server:', error);
        setServerStatus({
          isChecking: false,
          isOnline: false,
          error: error.message
        });
      }
    };

    checkServerStatus();
    
    // Set up periodic checking every 30 seconds
    const intervalId = setInterval(checkServerStatus, 30000);
    
    return () => clearInterval(intervalId);
  }, [OAUTH_SERVER_URL]);

  if (serverStatus.isChecking) {
    return <div className="server-status checking">Checking server status...</div>;
  }

  if (serverStatus.isOnline) {
    return (
      <div className="server-status online">
        <span className="status-indicator">●</span> Authentication server online
      </div>
    );
  }

  return (
    <div className="server-status offline">
      <span className="status-indicator">●</span> Authentication server offline
      <div className="server-error">Error: {serverStatus.error}</div>
      <div className="server-tips">
        <p>Tips:</p>
        <ul>
          <li>Make sure the authentication server is running on {OAUTH_SERVER_URL}</li>
          <li>Check that MongoDB is running and accessible</li>
          <li>Verify there are no network connectivity issues</li>
        </ul>
      </div>
    </div>
  );
};

export default ServerStatus;