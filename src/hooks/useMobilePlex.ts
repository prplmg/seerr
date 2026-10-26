import { useEffect, useState } from 'react';

export default function useMobilePlex() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    setMobile(
      /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) ||
        (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1)
    );
  }, []);
  return mobile;
}
