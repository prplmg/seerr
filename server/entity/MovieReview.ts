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
  @Column({ type: 'varchar' }) source: 'local' | 'letterboxd';
  @Column({ type: 'float', nullable: true }) rating: number | null;
  @Column({ type: 'text', default: '' }) text: string;
  @Column({ type: 'boolean', default: false }) spoiler: boolean;
  @Column({ type: 'varchar' }) @Index() publishedAt: string;
  @Column({ type: 'varchar' }) updatedAt: string;
  @Column({ type: 'varchar', nullable: true }) externalUrl: string | null;
  @Column({ type: 'varchar', nullable: true }) watchedDate: string | null;
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
  @Column({ type: 'varchar', nullable: true }) error: string | null;
}
