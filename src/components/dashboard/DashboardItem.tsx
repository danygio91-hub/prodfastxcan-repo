
"use client";

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";

export interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  onItemClick?: () => void;
  isDialogTrigger?: boolean;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  [key: string]: any;
}

const DashboardItem: React.FC<DashboardItemProps> = ({ 
  title, 
  description, 
  icon: Icon, 
  href, 
  onItemClick, 
  isDialogTrigger, 
  className: propClassName,
  onClick: triggerOnClick,
  ...rest 
}) => {
  const content = (
    <>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <Icon className="h-10 w-10 text-accent" />
          {(href || onItemClick || isDialogTrigger || triggerOnClick) && (
             <Button 
                variant="ghost" 
                size="icon" 
                className="text-accent hover:bg-accent/10" 
                onClick={(!isDialogTrigger && onItemClick) ? (e) => { e.stopPropagation(); onItemClick(); } : undefined}
                aria-hidden={isDialogTrigger || triggerOnClick ? true : undefined}
                tabIndex={isDialogTrigger || triggerOnClick ? -1 : undefined}
             >
              <ArrowRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-xl font-headline mb-1">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </>
  );

  const cardBaseClasses = "hover:shadow-lg transition-shadow duration-300 h-full";
  const isClickable = href || onItemClick || triggerOnClick || isDialogTrigger;
  const finalCardClassName = cn(cardBaseClasses, { 'cursor-pointer': isClickable }, propClassName);

  if (href && !isDialogTrigger) {
    return (
      <Link href={href} passHref className={cn("block", propClassName)} {...rest}>
        <Card className={finalCardClassName}>
          {content}
        </Card>
      </Link>
    );
  }

  return (
    <Card className={finalCardClassName} onClick={triggerOnClick || onItemClick} {...rest}>
      {content}
    </Card>
  );
};

export default React.memo(DashboardItem);
