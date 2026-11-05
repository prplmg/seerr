import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// No outbound publication fields: these records are catalogue-only. Retain them
// across transient removal/reimport of a review; routes require its existence.
@Entity()
@Index(['reviewId', 'createdAt', 'id'])
export class ReviewComment {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Column({ type: 'varchar' }) reviewId: string;
  @Column({ type: 'integer' }) userId: number;
  @Column({ type: 'text' }) text: string;
  @Column({ type: 'varchar' }) createdAt: string;
  @Column({ type: 'varchar' }) updatedAt: string;
}
@Entity()
@Index(['reviewId', 'userId', 'emoji'], { unique: true })
export class ReviewReaction {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Column({ type: 'varchar' }) reviewId: string;
  @Column({ type: 'integer' }) userId: number;
  @Column({ type: 'varchar' }) emoji: string;
}

@Entity()
@Index(['userId', 'lastUsed'])
export class RecentReaction {
  @PrimaryColumn({ type: 'integer' }) userId: number;
  @PrimaryColumn({ type: 'varchar' }) emoji: string;
  @Column({ type: 'varchar' }) lastUsed: string;
}
