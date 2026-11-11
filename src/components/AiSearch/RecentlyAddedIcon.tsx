import { useId } from 'react';

export default function RecentlyAddedIcon({
  className,
}: {
  className?: string;
}) {
  const outlineClipId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(0 4) scale(.015)" strokeWidth="40">
        <defs>
          <clipPath id={outlineClipId} clipPathUnits="userSpaceOnUse">
            <path d="M 92,300     C 92,222 160,158 236,158     C 280,158 309,183 345,220     L 568,437     C 604,472 643,472 679,437     L 902,220     C 938,183 967,158 1011,158     C 1093,158 1162,225 1162,308     L 1162,596     C 1162,620 1150,624 1135,608     C 1110,582 1080,571 1047,571     C 1003,571 974,590 950,616     C 940,628 931,635 919,621     C 890,587 859,570 818,570     C 772,570 750,593 716,628     C 684,661 658,677 625,677     C 585,677 557,659 522,633     L 396,541     C 364,518 329,513 298,525     C 253,541 229,576 229,622     L 229,983     C 229,1022 198,1053 160.5,1053     C 122,1053 92,1022 92,983     Z" />
          </clipPath>
        </defs>
        <path
          d="M 92,300     C 92,222 160,158 236,158     C 280,158 309,183 345,220     L 568,437     C 604,472 643,472 679,437     L 902,220     C 938,183 967,158 1011,158     C 1093,158 1162,225 1162,308     L 1162,596     C 1162,620 1150,624 1135,608     C 1110,582 1080,571 1047,571     C 1003,571 974,590 950,616     C 940,628 931,635 919,621     C 890,587 859,570 818,570     C 772,570 750,593 716,628     C 684,661 658,677 625,677     C 585,677 557,659 522,633     L 396,541     C 364,518 329,513 298,525     C 253,541 229,576 229,622     L 229,983     C 229,1022 198,1053 160.5,1053     C 122,1053 92,1022 92,983     Z"
          strokeWidth="80"
          clipPath={`url(#${outlineClipId})`}
        />
        <path
          fill="currentColor"
          stroke="none"
          d="M 269,636       C 269,583 312,549 356,579       L 624,769       C 655,791 655,823 624,845       L 356,1036       C 312,1067 269,1040 269,992       Z"
        />
        <rect
          fill="currentColor"
          stroke="none"
          x="727"
          y="621"
          width="177"
          height="432"
          rx="88.5"
        />
        <rect
          fill="currentColor"
          stroke="none"
          x="965"
          y="621"
          width="177"
          height="432"
          rx="88.5"
        />
      </g>
      <path d="M20 2v6M17 5h6" />
    </svg>
  );
}
