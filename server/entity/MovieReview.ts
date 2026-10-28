import { User } from '@server/entity/User';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

@Entity()
export class MovieReview {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Column({ type: 'integer' }) @Index() userId: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
  @Column({ type: 'integer' }) @Index() tmdbId: number;
  @Column({ type: 'varchar', default: 'movie' }) mediaType: 'movie' | 'tv';
  @Column({ type: 'integer', nullable: true }) seasonNumber: number | null;
  @Column({ type: 'integer', nullable: true }) episodeNumber: number | null;
  @Column({ type: 'varchar', nullable: true }) episodeName: string | null;
  @Column({ type: 'boolean', default: false }) watched: boolean;
  @Column({ type: 'varchar', default: 'diary' }) entryKind: 'summary' | 'diary';
  @Column({ type: 'varchar' }) source: 'local' | 'letterboxd';
  @Column({ type: 'float', nullable: true }) rating: number | null;
  @Column({ type: 'text', default: '' }) text: string;
  @Column({ type: 'boolean', default: false }) spoiler: boolean;
  @Column({ type: 'boolean', default: false }) syncToLetterboxd: boolean;
  @Column({ type: 'varchar' }) @Index() publishedAt: string;
  @Column({ type: 'varchar' }) updatedAt: string;
  @Column({ type: 'varchar', nullable: true }) externalUrl: string | null;
  @Column({ type: 'varchar', nullable: true }) externalEntryId: string | null;
  @Column({ type: 'varchar', nullable: true }) watchedDate: string | null;
  @Column({ type: 'varchar', nullable: true }) viewingEventId: string | null;
}

@Entity()
export class LetterboxdAccount {
  @PrimaryColumn({ type: 'integer' }) userId: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
  @Column({ type: 'varchar', unique: true }) username: string;
  @Column({ type: 'boolean', default: true }) enabled: boolean;
  @Column({ type: 'varchar', nullable: true }) lastSync: string | null;
  @Column({ type: 'varchar', nullable: true }) lastAttempt: string | null;
  @Column({ type: 'varchar', nullable: true }) importCompletedAt: string | null;
  @Column({ type: 'varchar', nullable: true }) error: string | null;
}
